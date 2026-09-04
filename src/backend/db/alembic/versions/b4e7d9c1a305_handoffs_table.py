"""handoffs table

Таблиця, якої не існувало НІДЕ, хоч маршрути передавання підключені й живі.

Виміряно 04.09.2026 на реальній базі власника й на живому вузлі:
  * `api/routes_handoff.py:80` оголошує модель `Handoff` (__tablename__
    "handoffs") — але оголошує її В МОДУЛІ МАРШРУТІВ, не в `db/models.py`;
  * жодна міграція таблиці не створює (`grep handoffs` по versions/ — нуль);
  * у базі власника її немає (73 таблиці, handoffs серед них відсутня);
  * `db/database.py:130` на старті виконує ЛИШЕ `alembic upgrade head`, якщо
    `alembic_version` вже є — а `create_all` лишився на застарілій
    доальбемічній гілці, тобто на жодному теперішньому встановленні не
    виконується;
  * `main.py:1159` роутер підключає, і `GET /api/v1/handoff/` на живому
    вузлі відповідає (307), тобто ділянка досяжна людині.

Разом: підключена функція, яка на КОЖЕН виклик падає в
`sqlite3.OperationalError: no such table: handoffs`. Пʼятнадцять червоних у
`tests/test_routes_handoff.py` були не застарілими тестами, а незачутою
сигналізацією — вони весь час казали правду про продукт.

Стовпці й індекси взято з моделі, а не з голови: імена й типи мусять
збігатися з тим, що ORM насправді вставляє (див. INSERT у трасуванні тих
тестів).

Revision ID: b4e7d9c1a305
Revises: a7c31f0b95e2
Create Date: 2026-09-04

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b4e7d9c1a305"
down_revision: Union[str, None] = "a7c31f0b95e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "handoffs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("origin_device_id", sa.String(length=36), nullable=True),
        sa.Column("target_device_id", sa.String(length=36), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False, server_default=""),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="pending"
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by_device_id", sa.String(length=36), nullable=True),
    )
    op.create_index("ix_handoffs_user_id", "handoffs", ["user_id"])
    op.create_index("ix_handoffs_user_status", "handoffs", ["user_id", "status"])
    op.create_index("ix_handoffs_target", "handoffs", ["target_device_id"])


def downgrade() -> None:
    op.drop_index("ix_handoffs_target", table_name="handoffs")
    op.drop_index("ix_handoffs_user_status", table_name="handoffs")
    op.drop_index("ix_handoffs_user_id", table_name="handoffs")
    op.drop_table("handoffs")
