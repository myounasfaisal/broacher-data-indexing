"""
Unit tests for the assistant's knowledge tools: house notes (P4) and the
semantic neighbour search (P3), in services.agent_tools.

The database layer is stubbed: what matters here is the CONTRACT the model
sees. Two behaviours are load-bearing and easy to regress —

  * an EMPTY regulatory lookup must tell the model it has no source at all,
    not merely that a list was empty. Silence there is what produces a
    confident wrong answer about a ban;
  * a substitution note with verdict 'avoid' must survive into the payload,
    because a swap the team already tried and rejected must never be handed
    back as a recommendation.
"""

import pytest

from app.services import agent_tools, database, embeddings


@pytest.fixture
def stub_db(monkeypatch):
    """Route every database call the notes tools make into a fake."""

    state = {
        "chemicals": [],
        "substitutions": [],
        "regulatory": [],
        "emails": {},
    }

    monkeypatch.setattr(
        database, "find_chemicals_by_name", lambda name, limit=5: state["chemicals"]
    )
    monkeypatch.setattr(
        database, "list_substitution_notes", lambda ids: state["substitutions"]
    )
    monkeypatch.setattr(
        database, "list_regulatory_notes", lambda ids: state["regulatory"]
    )
    monkeypatch.setattr(database, "get_user_emails", lambda ids: state["emails"])
    return state


class TestSubstitutionLookup:
    def test_unknown_chemical_does_not_imply_empty_catalog(self, stub_db):
        result = agent_tools._lookup_substitution_notes(chemical_name="unobtainium")

        assert result["returned"] == 0
        # The distinction the model has to be told explicitly: "no house note"
        # is not "we don't stock it".
        assert "search_catalog" in result["note"]

    def test_no_notes_recorded_falls_back_to_model_knowledge(self, stub_db):
        stub_db["chemicals"] = [{"id": "chem-1"}]

        result = agent_tools._lookup_substitution_notes(chemical_name="titanium dioxide")

        assert result["rows"] == []
        assert "own chemistry knowledge" in result["note"]

    def test_notes_carry_verdict_context_and_attribution(self, stub_db):
        stub_db["chemicals"] = [{"id": "chem-1"}]
        stub_db["emails"] = {"user-1": "ceo@bostech.example"}
        stub_db["substitutions"] = [
            {
                "id": "note-1",
                "from_chemical_id": "chem-1",
                "from_name": "Titanium dioxide",
                "to_chemical_id": None,
                "to_name": "Zinc oxide",
                "verdict": "avoid",
                "context": "GCC floor coatings, summer cure",
                "author_id": "user-1",
                "created_at": "2026-07-01T09:00:00+00:00",
            }
        ]

        result = agent_tools._lookup_substitution_notes(chemical_id="chem-1")
        row = result["rows"][0]

        assert row["verdict"] == "avoid"
        assert row["context"] == "GCC floor coatings, summer cure"
        assert row["author"] == "ceo@bostech.example"
        assert row["recorded"] == "2026-07-01"
        # Substitute we don't stock: still a valid note, flagged as such.
        assert row["to_in_catalog"] is False
        assert "OVERRIDE" in result["note"]

    def test_author_lookup_failure_keeps_the_note(self, stub_db, monkeypatch):
        stub_db["chemicals"] = [{"id": "chem-1"}]
        stub_db["substitutions"] = [
            {
                "id": "note-1",
                "from_name": "A",
                "to_chemical_id": "chem-2",
                "to_name": "B",
                "verdict": "works",
                "context": "anywhere",
                "author_id": "user-1",
                "created_at": "2026-07-01T09:00:00+00:00",
            }
        ]

        def boom(_ids):
            raise RuntimeError("auth API down")

        monkeypatch.setattr(database, "get_user_emails", boom)

        result = agent_tools._lookup_substitution_notes(chemical_id="chem-1")

        assert result["returned"] == 1
        assert result["rows"][0]["author"] is None


class TestRegulatoryLookup:
    def test_empty_result_forbids_answering_from_memory(self, stub_db):
        stub_db["chemicals"] = [{"id": "chem-1"}]

        result = agent_tools._lookup_regulatory_notes(chemical_name="DEG")

        assert result["returned"] == 0
        assert "do not state or imply a status" in result["note"]

    def test_recorded_status_keeps_jurisdiction_and_date(self, stub_db):
        stub_db["chemicals"] = [{"id": "chem-1"}]
        stub_db["regulatory"] = [
            {
                "id": "reg-1",
                "chemical_id": "chem-1",
                "chemical_name": "Titanium dioxide",
                "jurisdiction": "EU REACH",
                "status": "restricted",
                "effective_date": "2026-01-01",
                "note": "restricted above 0.1% w/w in consumer coatings",
                "source_url": "https://example.invalid/reach",
                "author_id": None,
                "created_at": "2026-07-01T09:00:00+00:00",
            }
        ]

        result = agent_tools._lookup_regulatory_notes(chemical_id="chem-1")
        row = result["rows"][0]

        assert row["jurisdiction"] == "EU REACH"
        assert row["effective_date"] == "2026-01-01"
        assert row["source_url"] == "https://example.invalid/reach"
        assert "jurisdiction and the date" in result["note"]


class TestSimilaritySearch:
    """
    find_similar_chemicals (P3). The behaviour under test is the DEGRADATION
    contract: with the index off or unreachable the tool must still answer,
    must label the answer as a name match, and must not let the model read
    absence as "we stock nothing" — a false negative on availability is the
    worst answer this assistant gives.
    """

    @pytest.fixture
    def catalog(self, monkeypatch):
        state = {"search": ([], 0), "neighbours": [], "listings": {}, "notes": []}
        monkeypatch.setattr(
            database, "search_listings", lambda **kw: state["search"]
        )
        monkeypatch.setattr(
            database, "find_chemicals_by_name", lambda name, limit=5: []
        )
        monkeypatch.setattr(
            database,
            "compare_suppliers",
            lambda chemical_id=None, cas_number=None, limit=40: state[
                "listings"
            ].get(chemical_id, []),
        )
        monkeypatch.setattr(
            database, "list_substitution_notes", lambda ids: state["notes"]
        )
        monkeypatch.setattr(
            embeddings, "similar_chemicals", lambda text, **kw: state["neighbours"]
        )
        return state

    def test_disabled_degrades_to_a_labelled_name_search(
        self, catalog, monkeypatch
    ):
        monkeypatch.setattr(embeddings, "enabled", lambda: False)
        catalog["search"] = ([{"id": "l1", "name_en": "Floor admixture"}], 1)

        result = agent_tools._find_similar_chemicals(description="floor coatings")

        assert result["degraded"] is True
        assert "DEGRADED" in result["note"]
        # The rows are real and citable, but must not be read as neighbours.
        assert result["rows"][0]["id"] == "l1"
        assert "do not conclude from this that we hold nothing" in result["note"]

    def test_unbuilt_index_degrades_rather_than_reporting_nothing(
        self, catalog, monkeypatch
    ):
        monkeypatch.setattr(embeddings, "enabled", lambda: True)
        monkeypatch.setattr(embeddings, "index_size", lambda: 0)

        result = agent_tools._find_similar_chemicals(description="pigment")

        assert result["degraded"] is True
        assert "not been built" in result["note"]

    def test_provider_failure_degrades(self, catalog, monkeypatch):
        monkeypatch.setattr(embeddings, "enabled", lambda: True)
        monkeypatch.setattr(embeddings, "index_size", lambda: 12)

        def boom(text, **kw):
            raise embeddings.EmbeddingError("down")

        monkeypatch.setattr(embeddings, "similar_chemicals", boom)

        result = agent_tools._find_similar_chemicals(description="pigment")

        assert result["degraded"] is True
        assert "temporarily unavailable" in result["note"]

    def test_neighbours_resolve_to_citable_listings(self, catalog, monkeypatch):
        monkeypatch.setattr(embeddings, "enabled", lambda: True)
        monkeypatch.setattr(embeddings, "index_size", lambda: 12)
        catalog["neighbours"] = [
            {"chemical_id": "c1", "name_en": "Zinc oxide", "similarity": 0.8123}
        ]
        catalog["listings"] = {"c1": [{"id": "l9", "name_en": "ZnO 99.7"}]}

        result = agent_tools._find_similar_chemicals(chemical_name="titanium dioxide")

        assert result["degraded"] is False
        assert result["rows"][0]["similarity"] == 0.812
        # Rows are real listings, so the citation allowlist picks them up and
        # the UI renders live prices rather than the model's prose.
        assert agent_tools.collect_listing_ids(result) == {"l9"}
        assert "never exceeds medium" in result["note"]

    def test_unbuyable_neighbours_are_dropped(self, catalog, monkeypatch):
        monkeypatch.setattr(embeddings, "enabled", lambda: True)
        monkeypatch.setattr(embeddings, "index_size", lambda: 12)
        catalog["neighbours"] = [
            {"chemical_id": "gone", "name_en": "Kaolin", "similarity": 0.9}
        ]
        catalog["listings"] = {}  # indexed, but nothing left to buy

        result = agent_tools._find_similar_chemicals(description="filler")

        # An alternative we cannot buy is trivia.
        assert result["rows"] == []
        assert "no current listing" in result["note"]
        assert "Nothing similar is stocked" in result["note"]

    def test_house_notes_outrank_a_similarity_score(self, catalog, monkeypatch):
        monkeypatch.setattr(embeddings, "enabled", lambda: True)
        monkeypatch.setattr(embeddings, "index_size", lambda: 12)
        monkeypatch.setattr(
            database, "find_chemicals_by_name", lambda name, limit=5: [{"id": "c0"}]
        )
        catalog["notes"] = [{"id": "n1"}]
        catalog["neighbours"] = [
            {"chemical_id": "c1", "name_en": "Zinc oxide", "similarity": 0.8}
        ]
        catalog["listings"] = {"c1": [{"id": "l9"}]}

        result = agent_tools._find_similar_chemicals(chemical_name="titanium dioxide")

        assert "lookup_substitution_notes" in result["note"]

    def test_requires_a_query(self, catalog):
        assert "error" in agent_tools._find_similar_chemicals()


class TestRegistry:
    def test_both_tools_are_exposed_to_every_provider(self):
        for name in (
            "lookup_substitution_notes",
            "lookup_regulatory_notes",
            "find_similar_chemicals",
        ):
            assert name in agent_tools.TOOLS_BY_NAME
            assert any(t["name"] == name for t in agent_tools.anthropic_schema())
            assert any(
                t["function"]["name"] == name for t in agent_tools.openai_schema()
            )

    def test_execute_drops_undeclared_arguments(self, stub_db):
        # Models occasionally invent a plausible extra parameter; it must not
        # become a TypeError that fails the whole exchange.
        result = agent_tools.execute(
            "lookup_substitution_notes",
            {"chemical_name": "toluene", "jurisdiction": "UAE"},
        )
        assert "error" not in result

    def test_notes_contribute_no_citable_listing_ids(self, stub_db):
        stub_db["chemicals"] = [{"id": "chem-1"}]
        stub_db["substitutions"] = [
            {
                "id": "note-1",
                "from_name": "A",
                "to_chemical_id": None,
                "to_name": "B",
                "verdict": "works",
                "context": "c",
                "author_id": None,
                "created_at": "2026-07-01T09:00:00+00:00",
            }
        ]
        result = agent_tools._lookup_substitution_notes(chemical_id="chem-1")

        # A note is not a listing. Nothing here may enter the citation
        # allowlist, or a note id could be rendered as a product row.
        assert agent_tools.collect_listing_ids(result) == set()
