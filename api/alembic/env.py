import os
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool, text
from alembic import context

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override URL from environment
database_url = os.environ.get("DATABASE_URL", "").replace("+asyncpg", "+psycopg2")
config.set_main_option("sqlalchemy.url", database_url)

from models.base import Base
from models import *  # noqa: F401, F403 — import all models so Alembic sees them
target_metadata = Base.metadata


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\""))
        # ── one line, and it is load-bearing ─────────────────────────────────
        # SQLAlchemy 2.0 "autobegins" a transaction on the first execute(), so
        # the three CREATE EXTENSION statements above leave `connection`
        # already inside one. Alembic's context.begin_transaction() then finds
        # an open transaction and returns a NESTED marker that does not commit
        # — and `with connectable.connect()` rolls back on exit.
        #
        # Net effect before this commit(): `alembic upgrade head` printed
        # "Running upgrade ..." for every revision, exited 0, and applied
        # NOTHING. Not even alembic_version moved. Verified on a scratch
        # database: after a clean "successful" run, the new column and index
        # were absent and version_num was unchanged.
        #
        # A migration tool that reports success and does nothing is worse than
        # one that fails, because you only find out in production.
        connection.commit()
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
