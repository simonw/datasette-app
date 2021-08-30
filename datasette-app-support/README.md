# datasette-app-support

Plugin adding extra features needed by datasette.app

## API endpoints

This plugin exposes APIs that are called by the Electron wrapper.

### /-/open-database-file

```
POST /-/open-database-file
{"path": "/path/to/file.db"}
```
Attaches a new database file to the running Datasette instance - used by the "Open Database..." menu option.

Returns HTTP 200 if it works, 400 with an `"error"` JSON string message if it fails.
