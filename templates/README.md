# Corporate contract templates

Drop Capco / Wipro Word (`.docx`) templates here. Nested folders are supported.

## Yellow fields

Any text highlighted **yellow** in Word becomes a fillable field:

| Placeholder style in Word | Indexed field key |
| --- | --- |
| `[Party Name]` | `party_name` |
| `{{effective_date}}` | `effective_date` |
| `[[CONFIDENTIALITY_TERM]]` | `confidentiality_term` |
| Free text highlighted yellow | slug of that text |

Optional sidecar metadata: place `my-template.meta.json` next to `my-template.docx`.

```json
{
  "id": "nda-mutual",
  "name": "Mutual NDA",
  "agreement_type": "NDA",
  "jurisdiction": "Hong Kong",
  "entity_scope": "Capco group",
  "description": "Standard mutual NDA"
}
```

After adding files, call `POST /api/v1/templates/reindex` or restart the API.
