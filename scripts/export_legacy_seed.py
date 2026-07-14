#!/usr/bin/env python3

from pathlib import Path
import sqlite3


ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "assets" / "data" / "invoices.db"
OUTPUT_PATH = ROOT / "supabase" / "legacy_seed.sql"


def sql_value(value):
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def build_seed_file():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row

    clients = connection.execute("select * from clients order by id").fetchall()
    projects = connection.execute("select * from projects order by id").fetchall()
    invoices = connection.execute("select * from invoices order by id").fetchall()
    time_entries = connection.execute("select * from time_entries order by id").fetchall()
    settings = connection.execute("select * from settings order by key").fetchall()

    with OUTPUT_PATH.open("w", encoding="utf-8") as handle:
      handle.write("delete from public.time_entries where id >= 0;\n")
      handle.write("delete from public.invoices where id >= 0;\n")
      handle.write("delete from public.projects where id >= 0;\n")
      handle.write("delete from public.clients where id >= 0;\n")
      handle.write("delete from public.settings where key <> '';\n\n")

      write_simple_insert(handle, "clients", clients)

      if projects:
          handle.write(
              "insert into public.projects (id, client_id, name, rate, description, active, created_at) values\n"
          )
          lines = []
          for row in projects:
              data = dict(row)
              lines.append(
                  f"  ({data['id']}, {data['client_id']}, {sql_value(data['name'])}, {data['rate']}, {sql_value(data['description'])}, {'true' if int(data['active']) else 'false'}, {sql_value(data['created_at'])})"
              )
          handle.write(",\n".join(lines))
          handle.write("\non conflict do nothing;\n\n")

      if invoices:
          handle.write(
              "insert into public.invoices (id, invoice_number, client_id, generated_at, detail_level, subtotal, pdf_path, status, paid_at, summary_pdf_path, project_pdf_path, detailed_pdf_path) values\n"
          )
          lines = []
          for row in invoices:
              data = dict(row)
              normalized_paths = {
                  key: (Path(value).name if key.endswith("pdf_path") and value else value)
                  for key, value in data.items()
              }
              lines.append(
                  f"  ({normalized_paths['id']}, {sql_value(normalized_paths['invoice_number'])}, {normalized_paths['client_id']}, {sql_value(normalized_paths['generated_at'])}, {sql_value(normalized_paths['detail_level'])}, {normalized_paths['subtotal']}, {sql_value(normalized_paths['pdf_path'])}, {sql_value(normalized_paths['status'] or 'unpaid')}, {sql_value(normalized_paths['paid_at'])}, {sql_value(normalized_paths['summary_pdf_path'])}, {sql_value(normalized_paths['project_pdf_path'])}, {sql_value(normalized_paths['detailed_pdf_path'])})"
              )
          handle.write(",\n".join(lines))
          handle.write("\non conflict do nothing;\n\n")

      if time_entries:
          handle.write(
              "insert into public.time_entries (id, project_id, start_at, end_at, hours, description, invoiced, invoice_id, created_at) values\n"
          )
          lines = []
          for row in time_entries:
              data = dict(row)
              lines.append(
                  f"  ({data['id']}, {data['project_id']}, {sql_value(data['start_at'])}, {sql_value(data['end_at'])}, {data['hours']}, {sql_value(data['description'])}, {'true' if int(data['invoiced']) else 'false'}, {sql_value(data['invoice_id'])}, {sql_value(data['created_at'])})"
              )
          handle.write(",\n".join(lines))
          handle.write("\non conflict do nothing;\n\n")

      if settings:
          handle.write("insert into public.settings (key, value) values\n")
          lines = []
          for row in settings:
              data = dict(row)
              value = "logos/company-logo.png" if data["key"] == "company_logo_path" else data["value"]
              lines.append(f"  ({sql_value(data['key'])}, {sql_value(value)})")
          handle.write(",\n".join(lines))
          handle.write("\non conflict (key) do update set value = excluded.value;\n\n")

      handle.write("select public.reset_hourmint_sequences();\n")

    print(OUTPUT_PATH)


def write_simple_insert(handle, table_name, rows):
    rows = list(rows)
    if not rows:
        return

    columns = list(rows[0].keys())
    handle.write(f"insert into public.{table_name} ({', '.join(columns)}) values\n")
    lines = []
    for row in rows:
        values = ", ".join(sql_value(row[column]) for column in columns)
        lines.append(f"  ({values})")
    handle.write(",\n".join(lines))
    handle.write("\non conflict do nothing;\n\n")


if __name__ == "__main__":
    build_seed_file()
