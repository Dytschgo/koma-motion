# Brand Kit library logos

The main process validates logo content when saving a Brand Kit, listing its
availability, and loading it for a project. A matching file size, signature and
SHA-256 hash alone do not make a historical logo available.

Renderer submissions must be canonical base64 within the 2 MB image budget
before decoding. Disk reads check the declared size before allocating and read
at most that size plus one byte. The read bytes must still match the size, hash,
media type and existing trusted image validator.

A corrupt saved logo is marked unavailable. Applying its kit reports that the
logo is damaged and applies the Brand Kit without the logo. Reading, loading,
applying, undoing or renaming the kit retains the referenced file and library
metadata. Existing explicit deletion and logo replacement behavior remain.

The shared validator checks dimensions and bounded structure, including PNG
compressed data. JPEG, GIF and WebP checks are structural; this is not a full
pixel decoder. The library service unit tests cover corrupt submissions,
matching-hash historical PNGs, size limits and unchanged authoritative files.
The native library spec covers the unavailable-logo apply/undo path alongside
valid logo reuse.
