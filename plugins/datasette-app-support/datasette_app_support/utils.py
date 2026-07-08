import sqlite_utils
from csv import DictReader
import io
import httpx
import urllib


async def derive_table_name(db, table_name):
    root_table_name = table_name
    i = 1
    while await db.table_exists(table_name):
        table_name = "{}_{}".format(root_table_name, i)
        i += 1
    return table_name


class AsyncDictReader:
    def __init__(self, async_line_iterator):
        self.async_line_iterator = async_line_iterator
        self.buffer = io.StringIO()
        self.reader = DictReader(self.buffer)
        self.line_num = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        # httpx >= 0.23 yields lines from aiter_lines() with their trailing
        # newline stripped; older httpx retained it. csv.DictReader needs the
        # separators to find row boundaries, so normalise every line to end in
        # exactly one "\n" regardless of the httpx version in use.
        if self.line_num == 0:
            header = await self.async_line_iterator.__anext__()
            self.buffer.write(header.rstrip("\r\n") + "\n")

        line = await self.async_line_iterator.__anext__()

        if not line:
            raise StopAsyncIteration

        self.buffer.write(line.rstrip("\r\n") + "\n")
        self.buffer.seek(0)

        try:
            result = next(self.reader)
        except StopIteration as e:
            raise StopAsyncIteration from e

        self.buffer.seek(0)
        self.buffer.truncate(0)
        self.line_num = self.reader.line_num

        return result


async def import_csv_url_to_database(url, db, requested_table_name=None):
    # Returns table_name, num_rows
    last_path_bit = urllib.parse.urlparse(url).path.split("/")[-1]
    last_path_bit_minus_extension = last_path_bit.rsplit(".", 1)[0]
    table_name = requested_table_name or (
        await derive_table_name(db, last_path_bit_minus_extension or "data_from_csv")
    )

    async def write_batch(rows):
        def _write(conn):
            db_conn = sqlite_utils.Database(conn)
            with db_conn.conn:
                db_conn[table_name].insert_all(rows)

        r = await db.execute_write_fn(_write, block=True)
        return r

    async with httpx.AsyncClient() as client:
        async with client.stream("GET", url, follow_redirects=True) as response:
            reader = AsyncDictReader(response.aiter_lines())
            batch = []
            num_rows = 0
            async for row in reader:
                num_rows += 1
                batch.append(row)
                if len(batch) >= 100:
                    # Write this batch to disk
                    await write_batch(batch)
                    batch = []
            if batch:
                await write_batch(batch)

    import asyncio

    await asyncio.sleep(1)

    return table_name, num_rows
