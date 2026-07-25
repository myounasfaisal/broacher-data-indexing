"""Unit tests for deterministic CAS normalization + checksum (services.cas)."""

from app.services import cas


class TestCanonicalize:
    def test_already_canonical(self):
        assert cas.canonicalize("108-88-3") == "108-88-3"

    def test_spaces_and_label_prefix(self):
        # "CAS: 108 88 3" and "CAS No. 108-88-3" both normalize the same way.
        assert cas.canonicalize("CAS: 108 88 3") == "108-88-3"
        assert cas.canonicalize("CAS No. 108-88-3") == "108-88-3"
        assert cas.canonicalize("CAS#108883") == "108-88-3"

    def test_run_together_digits(self):
        assert cas.canonicalize("1088 83") == "108-88-3"

    def test_short_valid_cas(self):
        # Formaldehyde 50-00-0 (5 digits) — leading group is a single-plus group.
        assert cas.canonicalize("50-00-0") == "50-00-0"

    def test_seven_digit_leading(self):
        assert cas.canonicalize("1234567-89-5") == "1234567-89-5"

    def test_out_of_range_returns_none(self):
        assert cas.canonicalize("12") is None            # too few digits
        assert cas.canonicalize("12345678901") is None   # too many digits
        assert cas.canonicalize("") is None
        assert cas.canonicalize(None) is None

    def test_non_cas_text(self):
        # No digits at all -> None, not a crash.
        assert cas.canonicalize("N/A") is None


class TestChecksum:
    def test_valid_checksums(self):
        # Toluene, water, ethanol, benzene — all real, all pass.
        assert cas.checksum_ok("108-88-3")   # toluene
        assert cas.checksum_ok("7732-18-5")  # water
        assert cas.checksum_ok("64-17-5")    # ethanol
        assert cas.checksum_ok("71-43-2")    # benzene

    def test_bad_check_digit(self):
        # Last digit wrong -> checksum fails (an OCR-style transcription error).
        assert not cas.checksum_ok("108-88-4")
        assert not cas.checksum_ok("7732-18-9")

    def test_none_or_empty(self):
        assert not cas.checksum_ok(None)
        assert not cas.checksum_ok("")


class TestNormalize:
    def test_full_pass(self):
        r = cas.normalize("CAS: 108-88-3")
        assert r.raw == "CAS: 108-88-3"
        assert r.canonical == "108-88-3"
        assert r.checksum_ok is True

    def test_checksum_failure_still_canonicalizes(self):
        # A transcription error: canonical form is produced, but checksum flags it.
        r = cas.normalize("108-88-4")
        assert r.canonical == "108-88-4"
        assert r.checksum_ok is False

    def test_raw_preserved_when_uncanonicalizable(self):
        # Out-of-range digits -> canonical None, but raw is kept for audit.
        r = cas.normalize("not-a-cas")
        assert r.raw == "not-a-cas"
        assert r.canonical is None
        assert r.checksum_ok is False
