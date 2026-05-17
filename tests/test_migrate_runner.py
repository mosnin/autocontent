"""Unit tests for scripts/migrate.py.

Strategy
--------
The existing migrations contain PostgreSQL-specific SQL (``gen_random_uuid()``,
``JSONB``, ``ENUM`` types, PL/pgSQL triggers) that cannot run on SQLite, so
we do NOT attempt to apply them against an in-memory SQLite database.

Instead these tests verify the *wiring*: argument parsing, sub-command
dispatch, and the public ``up`` / ``status`` / ``down`` functions — all via
mocks.  The CI Postgres service container (see ``.github/workflows/ci.yml``)
provides integration coverage for the actual SQL semantics.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_yoyo(monkeypatch):
    """Patch yoyo internals so no real DB connection is attempted."""
    fake_backend = MagicMock()
    fake_migrations = MagicMock()

    # Simulate three applied migrations and zero pending.
    applied_list = [MagicMock(), MagicMock(), MagicMock()]
    pending_list: list = []

    fake_backend.to_rollback.return_value = applied_list
    fake_backend.to_apply.return_value = pending_list
    # Support context-manager protocol for backend.lock()
    fake_backend.lock.return_value.__enter__ = MagicMock(return_value=None)
    fake_backend.lock.return_value.__exit__ = MagicMock(return_value=False)

    import scripts.migrate as migrate_mod  # noqa: PLC0415

    monkeypatch.setattr(
        migrate_mod,
        "_get_backend_and_migrations",
        lambda url: (fake_backend, fake_migrations),
    )
    monkeypatch.setattr(migrate_mod, "_get_database_url", lambda: "postgresql://fake/db")

    return fake_backend, fake_migrations, applied_list, pending_list


# ---------------------------------------------------------------------------
# CLI argument parsing
# ---------------------------------------------------------------------------


class TestCLIParsing:
    def test_up_subcommand(self):
        import scripts.migrate as migrate_mod  # noqa: PLC0415

        parser = migrate_mod._build_parser()
        args = parser.parse_args(["up"])
        assert args.command == "up"

    def test_status_subcommand(self):
        import scripts.migrate as migrate_mod  # noqa: PLC0415

        parser = migrate_mod._build_parser()
        args = parser.parse_args(["status"])
        assert args.command == "status"

    def test_down_default_n(self):
        import scripts.migrate as migrate_mod  # noqa: PLC0415

        parser = migrate_mod._build_parser()
        args = parser.parse_args(["down"])
        assert args.command == "down"
        assert args.n == 1

    def test_down_explicit_n(self):
        import scripts.migrate as migrate_mod  # noqa: PLC0415

        parser = migrate_mod._build_parser()
        args = parser.parse_args(["down", "3"])
        assert args.command == "down"
        assert args.n == 3

    def test_no_subcommand_exits_0(self):
        import scripts.migrate as migrate_mod  # noqa: PLC0415

        with pytest.raises(SystemExit) as exc_info:
            migrate_mod.main([])
        assert exc_info.value.code == 0


# ---------------------------------------------------------------------------
# status()
# ---------------------------------------------------------------------------


class TestStatus:
    def test_returns_applied_and_pending_counts(self, mock_yoyo):
        fake_backend, _, applied_list, pending_list = mock_yoyo
        import scripts.migrate as migrate_mod  # noqa: PLC0415

        result = migrate_mod.status()
        assert result == {"applied": 3, "pending": 0}

    def test_pending_non_zero(self, monkeypatch):
        fake_backend = MagicMock()
        fake_migrations = MagicMock()
        fake_backend.to_rollback.return_value = [MagicMock()]
        fake_backend.to_apply.return_value = [MagicMock(), MagicMock()]
        fake_backend.lock.return_value.__enter__ = MagicMock(return_value=None)
        fake_backend.lock.return_value.__exit__ = MagicMock(return_value=False)

        import scripts.migrate as migrate_mod  # noqa: PLC0415

        monkeypatch.setattr(
            migrate_mod,
            "_get_backend_and_migrations",
            lambda url: (fake_backend, fake_migrations),
        )
        monkeypatch.setattr(migrate_mod, "_get_database_url", lambda: "postgresql://fake/db")

        result = migrate_mod.status()
        assert result == {"applied": 1, "pending": 2}


# ---------------------------------------------------------------------------
# up()
# ---------------------------------------------------------------------------


class TestUp:
    def test_up_with_no_pending(self, mock_yoyo, capsys):
        fake_backend, _, _, _ = mock_yoyo
        import scripts.migrate as migrate_mod  # noqa: PLC0415

        migrate_mod.up()
        captured = capsys.readouterr()
        assert "up to date" in captured.out
        fake_backend.apply_migrations.assert_not_called()

    def test_up_applies_pending(self, monkeypatch, capsys):
        pending = [MagicMock(), MagicMock()]
        fake_backend = MagicMock()
        fake_migrations = MagicMock()
        fake_backend.to_rollback.return_value = []
        fake_backend.to_apply.return_value = pending
        fake_backend.lock.return_value.__enter__ = MagicMock(return_value=None)
        fake_backend.lock.return_value.__exit__ = MagicMock(return_value=False)

        import scripts.migrate as migrate_mod  # noqa: PLC0415

        monkeypatch.setattr(
            migrate_mod,
            "_get_backend_and_migrations",
            lambda url: (fake_backend, fake_migrations),
        )
        monkeypatch.setattr(migrate_mod, "_get_database_url", lambda: "postgresql://fake/db")

        migrate_mod.up()
        fake_backend.apply_migrations.assert_called_once_with(pending)
        captured = capsys.readouterr()
        assert "Applied 2" in captured.out


# ---------------------------------------------------------------------------
# down()
# ---------------------------------------------------------------------------


class TestDown:
    def test_down_rolls_back_last_n(self, monkeypatch, capsys):
        applied = [MagicMock(), MagicMock(), MagicMock()]
        fake_backend = MagicMock()
        fake_migrations = MagicMock()
        fake_backend.to_rollback.return_value = applied
        fake_backend.to_apply.return_value = []
        fake_backend.lock.return_value.__enter__ = MagicMock(return_value=None)
        fake_backend.lock.return_value.__exit__ = MagicMock(return_value=False)

        import scripts.migrate as migrate_mod  # noqa: PLC0415

        monkeypatch.setattr(
            migrate_mod,
            "_get_backend_and_migrations",
            lambda url: (fake_backend, fake_migrations),
        )
        monkeypatch.setattr(migrate_mod, "_get_database_url", lambda: "postgresql://fake/db")

        migrate_mod.down(n=2)
        fake_backend.rollback_migrations.assert_called_once_with(applied[:2])
        captured = capsys.readouterr()
        assert "Rolled back 2" in captured.out

    def test_down_no_applied(self, mock_yoyo, monkeypatch, capsys):
        fake_backend, fake_migrations, _, _ = mock_yoyo
        fake_backend.to_rollback.return_value = []

        import scripts.migrate as migrate_mod  # noqa: PLC0415

        migrate_mod.down(n=1)
        fake_backend.rollback_migrations.assert_not_called()
        captured = capsys.readouterr()
        assert "No applied" in captured.out


# ---------------------------------------------------------------------------
# main() dispatch
# ---------------------------------------------------------------------------


class TestMainDispatch:
    def test_main_up(self, mock_yoyo, capsys):
        import scripts.migrate as migrate_mod  # noqa: PLC0415

        # No pending migrations — just verifies dispatch doesn't crash.
        migrate_mod.main(["up"])

    def test_main_status_all_applied(self, mock_yoyo, capsys):
        import scripts.migrate as migrate_mod  # noqa: PLC0415

        # 3 applied, 0 pending → exit 0
        migrate_mod.main(["status"])
        out = capsys.readouterr().out
        assert "Applied: 3" in out
        assert "Pending: 0" in out

    def test_main_status_pending_exits_2(self, monkeypatch):
        import scripts.migrate as migrate_mod  # noqa: PLC0415

        monkeypatch.setattr(migrate_mod, "status", lambda **_: {"applied": 1, "pending": 1})
        monkeypatch.setattr(migrate_mod, "_get_database_url", lambda: "postgresql://fake/db")

        with pytest.raises(SystemExit) as exc_info:
            migrate_mod.main(["status"])
        assert exc_info.value.code == 2

    def test_main_down(self, mock_yoyo, capsys):
        fake_backend, _, applied_list, _ = mock_yoyo
        # Override to_rollback so there's something to roll back.
        fake_backend.to_rollback.return_value = [MagicMock()]

        import scripts.migrate as migrate_mod  # noqa: PLC0415

        migrate_mod.main(["down"])
        fake_backend.rollback_migrations.assert_called()

    def test_main_error_exits_1(self, monkeypatch):
        import scripts.migrate as migrate_mod  # noqa: PLC0415

        monkeypatch.setattr(
            migrate_mod, "up", MagicMock(side_effect=RuntimeError("boom"))
        )
        monkeypatch.setattr(migrate_mod, "_get_database_url", lambda: "postgresql://fake/db")

        with pytest.raises(SystemExit) as exc_info:
            migrate_mod.main(["up"])
        assert exc_info.value.code == 1
