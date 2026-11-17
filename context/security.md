# Security

Static client-only app. No accounts, no secrets, no network. Save data is untrusted on load: `deserialize` rejects anything without the expected version and shape, and the app falls back to a new world. Panel text is HTML-escaped.
