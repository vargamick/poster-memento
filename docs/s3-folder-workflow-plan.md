# S3 Folder-Based Upload & Processing Workflow

## Overview

This plan implements a clear separation between:

1. **Sessions** - Staging areas for images awaiting processing (transient)
2. **Live** - Canonical folder with one image per knowledge graph entity (permanent)

## Workflow

### New Upload Flow

1. User creates a session and uploads local images to it
2. User selects images from the session to process
3. Processing extracts metadata and creates entities in knowledge graph
4. Successfully processed images **move** from session to live folder
5. Session can be deleted once empty (or kept for retrying failed images)

### Existing Session Flow

1. User selects an existing session with unprocessed images
2. Continue from step 2 above

---

## S3 Structure

```text
bucket/
├── live/                              # CANONICAL: One image per KG entity
│   ├── images/
│   │   ├── abc123-concert-poster.jpg  # {hash}-{sanitized_name}
│   │   ├── def456-vintage-1975.jpg
│   │   └── ...
│   └── metadata/
│       ├── abc123.json                # Processing result/extraction data
│       ├── def456.json
│       └── ...
│
├── sessions/                          # STAGING: Images awaiting processing
│   ├── 2026-02-05_concert-posters/
│   │   ├── images/
│   │   │   ├── ghi789-pending1.jpg
│   │   │   └── jkl012-pending2.jpg
│   │   └── session.json               # {name, created, status}
│   │
│   └── 2026-02-04_vintage-posters/
│       ├── images/
│       └── session.json
│
└── failed/                            # Images that failed processing
    ├── images/
    │   └── mno345-corrupted.jpg
    └── errors/
        └── mno345.json                # Error details for debugging
```

---

## Key Concepts

### Live Folder

- **Single source of truth** for images in the system
- One image file per entity in the knowledge graph
- Images only exist here if they have a corresponding entity
- Presigned URLs for the Browse UI always point here
- Never deleted unless entity is deleted from knowledge graph

### Sessions

- **Temporary staging areas** for batch uploads
- User can have multiple sessions (different projects/batches)
- Images leave the session when successfully processed (moved to live)
- Sessions can be deleted when empty
- Failed images can stay in session for retry, or move to failed/

### Processing Flow

```text
Session Upload → Select → Process → Success? → Move to Live + Create Entity
                                  ↘ Failure? → Stay in Session (or move to Failed)
```

---

## API Endpoints

### Session Management

| Endpoint | Method | Purpose |
| -------- | ------ | ------- |
| `/api/v1/sessions` | GET | List all sessions |
| `/api/v1/sessions` | POST | Create new session |
| `/api/v1/sessions/:sessionId` | GET | Get session details & stats |
| `/api/v1/sessions/:sessionId` | DELETE | Delete session (must be empty) |

### Session Images

| Endpoint | Method | Purpose |
| -------- | ------ | ------- |
| `/api/v1/sessions/:sessionId/images` | GET | List images in session |
| `/api/v1/sessions/:sessionId/images` | POST | Upload single image to session |
| `/api/v1/sessions/:sessionId/images/batch` | POST | Batch upload images to session |
| `/api/v1/sessions/:sessionId/images/:hash` | DELETE | Remove image from session |

### Processing

| Endpoint | Method | Purpose |
| -------- | ------ | ------- |
| `/api/v1/sessions/:sessionId/process` | POST | Process selected images from session |

### Live Images

| Endpoint | Method | Purpose |
| -------- | ------ | ------- |
| `/api/v1/live/images` | GET | List all live images |
| `/api/v1/live/images/:hash` | GET | Get presigned URL for live image |
| `/api/v1/live/images/:hash` | DELETE | Delete live image (also deletes entity) |
| `/api/v1/live/stats` | GET | Get live folder statistics |

---

## API Specifications

### POST /api/v1/sessions

Create a new upload session.

```json
// Request
{
  "name": "Concert Posters February 2026"
}

// Response
{
  "success": true,
  "session": {
    "sessionId": "2026-02-05_concert-posters-february-2026",
    "name": "Concert Posters February 2026",
    "created": "2026-02-05T10:30:00Z",
    "imageCount": 0
  }
}
```

### GET /api/v1/sessions

List all sessions.

```json
// Response
{
  "sessions": [
    {
      "sessionId": "2026-02-05_concert-posters",
      "name": "Concert Posters",
      "created": "2026-02-05T10:30:00Z",
      "imageCount": 47,
      "totalSizeBytes": 156000000
    },
    {
      "sessionId": "2026-02-04_vintage-1970s",
      "name": "Vintage 1970s",
      "created": "2026-02-04T14:00:00Z",
      "imageCount": 5,
      "totalSizeBytes": 12000000
    }
  ],
  "totalSessions": 2
}
```

### GET /api/v1/sessions/:sessionId/images

List images in a session.

```json
// Response
{
  "sessionId": "2026-02-05_concert-posters",
  "sessionName": "Concert Posters",
  "images": [
    {
      "hash": "a1b2c3d4",
      "filename": "poster1.jpg",
      "sizeBytes": 2450000,
      "uploadedAt": "2026-02-05T10:35:00Z",
      "url": "https://minio:9010/bucket/sessions/.../a1b2c3d4-poster1.jpg?..."
    },
    {
      "hash": "e5f6g7h8",
      "filename": "poster2.jpg",
      "sizeBytes": 1800000,
      "uploadedAt": "2026-02-05T10:35:01Z",
      "url": "https://minio:9010/bucket/sessions/.../e5f6g7h8-poster2.jpg?..."
    }
  ],
  "totalImages": 47
}
```

### POST /api/v1/sessions/:sessionId/process

Process selected images from session.

```json
// Request
{
  "hashes": ["a1b2c3d4", "e5f6g7h8"],  // Specific images, or omit for all
  "modelKey": "minicpm-v-ollama",
  "batchSize": 5
}

// Response
{
  "success": true,
  "processed": 2,
  "results": [
    {
      "hash": "a1b2c3d4",
      "success": true,
      "entityName": "poster_a1b2c3d4_poster1",
      "title": "Grateful Dead at Winterland",
      "movedToLive": true
    },
    {
      "hash": "e5f6g7h8",
      "success": false,
      "error": "Vision model failed to extract metadata",
      "movedToLive": false
    }
  ],
  "sessionRemaining": 45
}
```

### GET /api/v1/live/images

List all images in the live folder (one per KG entity).

```json
// Response
{
  "images": [
    {
      "hash": "a1b2c3d4",
      "filename": "poster1.jpg",
      "entityName": "poster_a1b2c3d4_poster1",
      "sizeBytes": 2450000,
      "processedAt": "2026-02-05T10:40:00Z",
      "url": "https://minio:9010/bucket/live/images/a1b2c3d4-poster1.jpg?..."
    }
  ],
  "totalImages": 156,
  "totalSizeBytes": 450000000
}
```

### GET /api/v1/live/stats

Get statistics about the live folder.

```json
// Response
{
  "totalImages": 156,
  "totalSizeBytes": 450000000,
  "entityCount": 156,
  "oldestImage": "2026-01-15T08:00:00Z",
  "newestImage": "2026-02-05T10:40:00Z"
}
```

---

## Implementation Plan

### Phase 1: Backend - Storage Service

**File:** `src/image-processor/ImageStorageService.ts`

Add new methods:

```typescript
// Session Management
createSession(name: string): Promise<SessionInfo>
listSessions(): Promise<SessionInfo[]>
getSession(sessionId: string): Promise<SessionInfo | null>
deleteSession(sessionId: string): Promise<void>

// Session Image Operations
uploadToSession(sessionId: string, localPath: string): Promise<SessionImage>
listSessionImages(sessionId: string): Promise<SessionImage[]>
deleteSessionImage(sessionId: string, hash: string): Promise<void>

// Live Folder Operations
moveToLive(sessionId: string, hash: string, entityName: string): Promise<LiveImage>
listLiveImages(): Promise<LiveImage[]>
getLiveImageUrl(hash: string): Promise<string>
deleteLiveImage(hash: string): Promise<void>
getLiveStats(): Promise<LiveStats>

// Processing Result Storage
storeLiveMetadata(hash: string, metadata: ProcessingResult): Promise<void>
getLiveMetadata(hash: string): Promise<ProcessingResult | null>
```

### Phase 2: Backend - API Routes

**File:** `src/api/routes/sessions.ts` (new file)

- Implement all session endpoints
- Handle multipart uploads
- Validate session existence

**File:** `src/api/routes/live.ts` (new file)

- Implement live folder endpoints
- Presigned URL generation
- Stats aggregation

### Phase 3: Frontend - UI

**Files:**

- `instances/posters/ui/index.html`
- `instances/posters/ui/js/processing.js`
- `instances/posters/ui/js/api.js`

#### UI Flow

```text
┌─────────────────────────────────────────────────────────────────────┐
│  Step 1: Select or Create Session                                    │
│                                                                      │
│  ┌──────────────────┐  ┌────────────────────────────────────────┐   │
│  │ + New Session    │  │ Select Existing Session          ▼     │   │
│  └──────────────────┘  └────────────────────────────────────────┘   │
│                                                                      │
│  Existing: [Concert Posters (47)] [Vintage 1970s (5)] [Empty (0)]   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
           ┌───────────────┐             ┌───────────────┐
           │ New Session   │             │ Existing      │
           │ → Upload      │             │ → Show Images │
           └───────────────┘             └───────────────┘
                    │                             │
                    └──────────────┬──────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 2: Upload Images (only shown for new/empty sessions)          │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  📁 Browse Local Folder                                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Selected: /Users/mick/Desktop/concert-posters (47 images)          │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  ⬆ Upload to Session                                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Progress: ████████████░░░░░░░░ 60% (28/47)                         │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 3: Select Images for Processing                                │
│                                                                      │
│  Session: Concert Posters (47 images)                                │
│                                                                      │
│  Filter: [____________]                                              │
│                                                                      │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐                 │
│  │ ☑  │ ☑  │ ☐  │ ☑  │ ☐  │ ☑  │ ☑  │ ☑  │  ...               │
│  │ img │ img │ img │ img │ img │ img │ img │ img │                 │
│  └─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘                 │
│                                                                      │
│  Selected: 35 of 47                                                  │
│  [Select All] [Clear Selection]                                      │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 4: Process                                                     │
│                                                                      │
│  Vision Model: [minicpm-v-ollama        ▼]                          │
│  Batch Size:   [5 ▼]                                                │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  ▶ Start Processing (35 images)                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Processing: ████████░░░░░░░░░░ 40% (14/35)                         │
│  ✓ 12 moved to Live  ✗ 2 failed                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Phase 4: Migration

For existing data in the flat structure:

1. Create endpoint `POST /api/v1/migrate-to-live`
2. Scan existing `originals/` and `processed/` folders
3. For each image with a corresponding entity in Neo4j:
   - Move to `live/images/`
   - Move processing result to `live/metadata/`
4. Orphaned images (no entity) go to a `legacy` session

---

## Data Types

```typescript
interface SessionInfo {
  sessionId: string;       // "2026-02-05_concert-posters"
  name: string;            // "Concert Posters"
  created: string;         // ISO timestamp
  imageCount: number;
  totalSizeBytes: number;
}

interface SessionImage {
  hash: string;
  filename: string;
  sizeBytes: number;
  uploadedAt: string;
  url: string;             // Presigned URL
}

interface LiveImage {
  hash: string;
  filename: string;
  entityName: string;      // Corresponding KG entity
  sizeBytes: number;
  processedAt: string;
  url: string;             // Presigned URL
}

interface LiveStats {
  totalImages: number;
  totalSizeBytes: number;
  entityCount: number;
  oldestImage: string;
  newestImage: string;
}

interface ProcessingResult {
  hash: string;
  entityName: string;
  title?: string;
  extractedData: Record<string, unknown>;
  modelKey: string;
  processedAt: string;
}
```

---

## Files to Create/Modify

### New Files

| File | Purpose |
| ---- | ------- |
| `src/api/routes/sessions.ts` | Session management endpoints |
| `src/api/routes/live.ts` | Live folder endpoints |
| `src/image-processor/types/storage.ts` | Storage-related types |

### Modified Files

| File | Changes |
| ---- | ------- |
| `src/image-processor/ImageStorageService.ts` | Add session and live methods |
| `src/api/server.ts` | Mount new routes |
| `instances/posters/ui/index.html` | Restructure processing tab |
| `instances/posters/ui/js/processing.js` | Session-based workflow |
| `instances/posters/ui/js/api.js` | New API methods |

---

## Summary

**Sessions** = Temporary staging for uploads and processing
**Live** = Permanent store with 1:1 mapping to Knowledge Graph entities

| Aspect | Sessions | Live |
| ------ | -------- | ---- |
| Purpose | Staging/upload | Canonical storage |
| Lifecycle | Created → Filled → Emptied → Deleted | Permanent |
| Image count | Variable | One per KG entity |
| When images move | Never (uploaded here) | After successful processing |
| UI access | Processing tab | Browse tab (existing) |
