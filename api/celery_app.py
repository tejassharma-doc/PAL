"""Celery application for PAL background jobs.

Broker + result backend reuse PAL's existing Redis on dedicated logical DBs
(/3 broker, /4 backend) — no new infrastructure. The only scheduled job is a
60-second "tick" that scans medication schedules for doses due this minute; the
per-dose reminder and its +10min acknowledgement follow-up are enqueued
dynamically from that scan (see tasks/medication_tasks.py).

Run (see docker-compose.prod.yml):
    celery -A celery_app worker -l info
    celery -A celery_app beat   -l info
    celery -A celery_app flower --port=5555 --url_prefix=flower
"""
from celery import Celery

from config import get_settings

settings = get_settings()

celery_app = Celery(
    "pal",
    broker=settings.celery_broker(),
    backend=settings.celery_backend(),
    include=["tasks.medication_tasks"],
)

celery_app.conf.update(
    timezone=settings.celery_timezone,
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=3600,
    beat_schedule={
        "scan-due-medications": {
            "task": "tasks.medication_tasks.scan_due_medication_reminders",
            "schedule": 60.0,  # every minute
        },
    },
)
