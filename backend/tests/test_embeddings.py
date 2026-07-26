"""
Unit tests for the semantic index (services.embeddings, P3).

The provider and the database are both stubbed. What is worth locking down
here is not "does it call an API" but the three properties the index's
usefulness rests on:

  * source text is DETERMINISTIC — it doubles as the change detector, so any
    set-iteration order leaking into it would re-embed the whole catalog on
    every run;
  * vectors are matched to inputs by the provider's own `index`, never by
    arrival order — an off-by-one there attaches each chemical's vector to its
    neighbour and nothing downstream would notice;
  * a provider failure DEGRADES. Indexing is a background nicety; it must
    never take a finished upload or a user's question down with it.
"""

from types import SimpleNamespace

import pytest

from app.config import settings
from app.services import database, embeddings


@pytest.fixture
def on(monkeypatch):
    """Turn the feature on for the duration of one test."""
    monkeypatch.setattr(settings, "embeddings_enabled", True)
    monkeypatch.setattr(settings, "embedding_dim", 4)
    monkeypatch.setattr(settings, "embedding_batch_size", 2)


def _fake_client(vectors_by_text, *, fail=False, shuffle=False):
    """A stand-in for the OpenAI-compatible embeddings client."""

    class Embeddings:
        calls: list[list[str]] = []

        def create(self, model, input, dimensions):  # noqa: A002 - SDK's name
            Embeddings.calls.append(list(input))
            if fail:
                raise RuntimeError("provider exploded")
            items = [
                SimpleNamespace(index=i, embedding=vectors_by_text[t])
                for i, t in enumerate(input)
            ]
            # Some endpoints return items out of order; the caller must sort
            # by `index` rather than trusting arrival order.
            return SimpleNamespace(data=list(reversed(items)) if shuffle else items)

    return SimpleNamespace(embeddings=Embeddings())


class TestSourceText:
    def test_composes_name_cas_trade_names_and_details(self):
        text = embeddings.build_source_text(
            {"name_en": "Titanium dioxide", "cas_number": "13463-67-7"},
            [
                {
                    "name_en": "Titanium dioxide",
                    "name_raw": "TiO2 R-996",
                    "details": {"application": "coatings", "grade": "rutile"},
                }
            ],
        )

        assert text.startswith("Titanium dioxide | CAS 13463-67-7")
        assert "TiO2 R-996" in text
        # The KEY is kept, not just the value: sourcing questions are phrased
        # in application language.
        assert "application: coatings" in text

    def test_is_deterministic_across_input_order(self):
        chemical = {"name_en": "Epoxy resin", "cas_number": None}
        a = embeddings.build_source_text(
            chemical,
            [
                {"name_raw": "Grade B", "details": {"z": "1", "a": "2"}},
                {"name_raw": "Grade A", "details": {"m": "3"}},
            ],
        )
        b = embeddings.build_source_text(
            chemical,
            [
                {"name_raw": "Grade A", "details": {"m": "3"}},
                {"name_raw": "Grade B", "details": {"a": "2", "z": "1"}},
            ],
        )
        # Byte-identical, or the skip-unchanged check is worthless.
        assert a == b

    def test_drops_logistics_noise(self):
        text = embeddings.build_source_text(
            {"name_en": "Kaolin"},
            [{"details": {"packaging": "25kg bag", "moq": "1 MT",
                          "application": "filler"}}],
        )
        # Two unrelated substances must not look alike for shipping in the
        # same sack.
        assert "25kg" not in text
        assert "1 MT" not in text
        assert "application: filler" in text

    def test_is_length_capped(self):
        text = embeddings.build_source_text(
            {"name_en": "X"},
            [{"details": {f"key{i}": "y" * 100 for i in range(50)}}],
        )
        assert len(text) <= 1200


class TestEmbedTexts:
    def test_batches_to_the_configured_size(self, on, monkeypatch):
        vectors = {t: [1.0, 2.0, 3.0, 4.0] for t in ("a", "b", "c")}
        client = _fake_client(vectors)
        monkeypatch.setattr(embeddings, "_get_client", lambda: client)

        out = embeddings.embed_texts(["a", "b", "c"])

        assert len(out) == 3
        assert client.embeddings.calls == [["a", "b"], ["c"]]

    def test_orders_by_provider_index_not_arrival(self, on, monkeypatch):
        vectors = {"a": [1.0] * 4, "b": [2.0] * 4}
        monkeypatch.setattr(
            embeddings, "_get_client", lambda: _fake_client(vectors, shuffle=True)
        )

        out = embeddings.embed_texts(["a", "b"])

        # Reversed on the wire; must come back aligned with the inputs.
        assert out == [[1.0] * 4, [2.0] * 4]

    def test_dimension_mismatch_is_an_error_not_a_bad_row(self, on, monkeypatch):
        monkeypatch.setattr(
            embeddings, "_get_client", lambda: _fake_client({"a": [1.0, 2.0]})
        )
        with pytest.raises(embeddings.EmbeddingError):
            embeddings.embed_texts(["a"])

    def test_disabled_refuses_rather_than_returning_nothing(self, monkeypatch):
        monkeypatch.setattr(settings, "embeddings_enabled", False)
        with pytest.raises(embeddings.EmbeddingsDisabled):
            embeddings.embed_texts(["a"])


class TestRefresh:
    @pytest.fixture
    def db(self, monkeypatch):
        state = {
            "chemicals": {"c1": {"id": "c1", "name_en": "Zinc oxide",
                                 "cas_number": "1314-13-2"}},
            "listings": [{"chemical_id": "c1", "name_en": "Zinc oxide",
                          "name_raw": "ZnO 99.7", "details": {"grade": "rubber"}}],
            "existing": {},
            "written": [],
        }
        monkeypatch.setattr(
            database, "get_chemicals_by_ids", lambda ids: state["chemicals"]
        )
        monkeypatch.setattr(
            database, "listings_for_chemicals", lambda ids: state["listings"]
        )
        monkeypatch.setattr(
            database, "get_embedding_source_texts", lambda ids: state["existing"]
        )
        monkeypatch.setattr(
            database,
            "upsert_chemical_embeddings",
            lambda rows: (state["written"].extend(rows), len(rows))[1],
        )
        return state

    def test_embeds_a_changed_chemical(self, on, db, monkeypatch):
        monkeypatch.setattr(embeddings, "embed_texts", lambda texts: [[0.5] * 4])

        stats = embeddings.refresh_chemicals(["c1"])

        assert stats["embedded"] == 1
        assert db["written"][0]["chemical_id"] == "c1"
        assert db["written"][0]["source_text"].startswith("Zinc oxide")

    def test_skips_an_unchanged_chemical(self, on, db, monkeypatch):
        text = embeddings.build_source_text(db["chemicals"]["c1"], db["listings"])
        db["existing"] = {"c1": text}
        monkeypatch.setattr(
            embeddings,
            "embed_texts",
            lambda texts: pytest.fail("should not call the provider"),
        )

        stats = embeddings.refresh_chemicals(["c1"])

        # Re-running over a settled catalog must cost nothing.
        assert stats == {"considered": 1, "embedded": 0, "skipped": 1}

    def test_force_re_embeds_even_when_unchanged(self, on, db, monkeypatch):
        text = embeddings.build_source_text(db["chemicals"]["c1"], db["listings"])
        db["existing"] = {"c1": text}
        monkeypatch.setattr(embeddings, "embed_texts", lambda texts: [[0.1] * 4])

        assert embeddings.refresh_chemicals(["c1"], force=True)["embedded"] == 1

    def test_provider_failure_degrades_and_writes_nothing(self, on, db, monkeypatch):
        def boom(_texts):
            raise embeddings.EmbeddingError("down")

        monkeypatch.setattr(embeddings, "embed_texts", boom)

        # A finished upload must never be held back by the embedding provider.
        stats = embeddings.refresh_chemicals(["c1"])

        assert stats["embedded"] == 0
        assert db["written"] == []

    def test_disabled_is_a_no_op(self, db, monkeypatch):
        monkeypatch.setattr(settings, "embeddings_enabled", False)
        assert embeddings.refresh_chemicals(["c1"])["embedded"] == 0

    def test_chemicals_with_no_listings_are_not_indexed(self, on, db, monkeypatch):
        db["listings"] = []  # identity exists, nothing to buy
        monkeypatch.setattr(
            embeddings,
            "embed_texts",
            lambda texts: pytest.fail("should not embed an unbuyable chemical"),
        )

        stats = embeddings.refresh_chemicals(["c1"])

        # Two thirds of the live `chemicals` table is CAS-lookup identities no
        # brochure ever listed. Indexing them would let unbuyable rows fill
        # every similarity result, only to be dropped downstream.
        assert stats == {"considered": 1, "embedded": 0, "skipped": 1}
        assert db["written"] == []


class TestVectorLiteral:
    def test_pgvector_text_form(self):
        assert database.to_vector_literal([0.5, -1.0]) == "[0.5,-1.0]"
