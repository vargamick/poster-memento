# Poster API & UI Implementation Plan

## Overview

Build a robust facility for retrieving posters and their metadata from the poster-memento knowledge graph via authenticated REST API calls, with a JavaScript/HTML UI for browsing and searching.

## Current State

- **API Server**: Running on `localhost:3000` with REST endpoints at `/api/v1/`
- **Authentication**: Requires `MEMENTO_API_KEY` environment variable (currently not configured)
- **Database**: Neo4j on port 7693 with poster entities stored
- **Existing Endpoints**: `/api/v1/entities`, `/api/v1/search`, `/api/v1/relations`

## Goals

1. Configure API key authentication properly
2. Ensure API endpoints return clean, structured poster data
3. Build a standalone HTML/JavaScript UI for browsing posters
4. Support filtering, search, and pagination

---

## Phase 1: API Configuration

### 1.1 Set Up API Key

**File**: `instances/posters/.env`

Add the following environment variable:
```env
MEMENTO_API_KEY=posters-api-key-2024
```

**File**: `/Users/mick/AI/GregRako/PastedandWasted/poster-memento/.env`

Add the same key to the root .env for the running server:
```env
MEMENTO_API_KEY=posters-api-key-2024
```

### 1.2 Restart API Server

The http-server needs to be restarted to pick up the new environment variable.

---

## Phase 2: Verify/Enhance API Endpoints

### 2.1 Entity Retrieval Endpoint

**Endpoint**: `GET /api/v1/entities`

**Required Parameters**:
- `entityTypes=Poster` - Filter to poster entities only
- `limit=N` - Number of results (default 10, max 100)
- `offset=N` - Pagination offset
- `fields=name,observations,createdAt,id` - Optional field projection

**Headers**:
```
X-API-Key: posters-api-key-2024
```

**Expected Response**:
```json
{
  "data": {
    "entities": [
      {
        "name": "poster_xxx",
        "entityType": "Poster",
        "observations": ["..."],
        "createdAt": 1234567890,
        "id": "uuid"
      }
    ]
  },
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 100
  }
}
```

### 2.2 Search Endpoint

**Endpoint**: `GET /api/v1/search`

**Parameters**:
- `q=search term` - Search query
- `entityTypes=Poster` - Filter to posters
- `limit=N` - Results limit
- `strategy=hybrid` - Search strategy (graph/vector/hybrid)

### 2.3 Single Entity Endpoint

**Endpoint**: `GET /api/v1/entities/:name`

Returns full details for a single poster including relations.

---

## Phase 3: JavaScript/HTML UI

### 3.1 File Structure

```
instances/posters/ui/
├── index.html          # Main UI page
├── css/
│   └── styles.css      # Styling
├── js/
│   ├── api.js          # API client module
│   ├── ui.js           # UI rendering logic
│   └── app.js          # Main application
└── README.md           # Usage instructions
```

### 3.2 Core Components

#### API Client (`js/api.js`)

```javascript
class PosterAPI {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async getPosters(options = {}) {
    const { limit = 10, offset = 0, search = '' } = options;
    const params = new URLSearchParams({
      entityTypes: 'Poster',
      limit: limit.toString(),
      offset: offset.toString(),
      ...(search && { q: search })
    });

    const response = await fetch(`${this.baseUrl}/api/v1/entities?${params}`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
  }

  async getPoster(name) {
    const response = await fetch(`${this.baseUrl}/api/v1/entities/${encodeURIComponent(name)}`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
  }

  async searchPosters(query, options = {}) {
    const { limit = 10, strategy = 'hybrid' } = options;
    const params = new URLSearchParams({
      q: query,
      entityTypes: 'Poster',
      limit: limit.toString(),
      strategy
    });

    const response = await fetch(`${this.baseUrl}/api/v1/search?${params}`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
  }
}
```

#### Main HTML (`index.html`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Poster Memento - Browser</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>Poster Memento</h1>
      <div class="search-bar">
        <input type="text" id="search-input" placeholder="Search posters...">
        <button id="search-btn">Search</button>
      </div>
    </header>

    <main>
      <div class="controls">
        <select id="limit-select">
          <option value="10">10 per page</option>
          <option value="25">25 per page</option>
          <option value="50">50 per page</option>
        </select>
        <div class="pagination">
          <button id="prev-btn" disabled>Previous</button>
          <span id="page-info">Page 1</span>
          <button id="next-btn">Next</button>
        </div>
      </div>

      <div id="poster-grid" class="poster-grid">
        <!-- Posters rendered here -->
      </div>

      <div id="poster-detail" class="poster-detail hidden">
        <!-- Single poster detail view -->
      </div>
    </main>

    <footer>
      <p>Total: <span id="total-count">0</span> posters</p>
    </footer>
  </div>

  <script type="module" src="js/app.js"></script>
</body>
</html>
```

### 3.3 Features

1. **Grid View**: Display posters in a responsive grid
2. **Search**: Full-text and semantic search
3. **Pagination**: Navigate through results
4. **Detail View**: Click poster to see full metadata
5. **Filtering**: Filter by poster type, date, venue, etc.
6. **Export**: Export selected posters as JSON

### 3.4 Styling

- Clean, modern design
- Responsive layout (mobile-friendly)
- Card-based poster display
- Modal for detail view
- Loading states and error handling

---

## Phase 4: Serving the UI

### Option A: Static File Serving (Recommended)

Add the UI to the existing Express server's static file serving:

**File**: `src/servers/http-server.ts`

Add after line 279:
```typescript
// Poster UI
const posterUiDir = path.join(__dirname, '../../instances/posters/ui');
app.use('/posters', express.static(posterUiDir));
logger.info('Poster UI enabled at /posters');
```

Access at: `http://localhost:3000/posters/`

### Option B: Standalone Server

Create a simple HTTP server for development:

```bash
cd instances/posters/ui
npx serve -p 8080
```

---

## Phase 5: Configuration

### 5.1 UI Configuration File

**File**: `instances/posters/ui/config.js`

```javascript
export const config = {
  apiBaseUrl: 'http://localhost:3000',
  apiKey: 'posters-api-key-2024',  // In production, load from env/prompt
  defaultLimit: 10,
  defaultSearchStrategy: 'hybrid'
};
```

### 5.2 Environment-Based Configuration

For production, the API key should be:
- Entered by user on first load
- Stored in localStorage (with user consent)
- Or loaded from a secure configuration endpoint

---

## Implementation Order

1. **[Phase 1]** Configure API key in environment files
2. **[Phase 1]** Restart API server and verify authentication works
3. **[Phase 2]** Test API endpoints with curl/Postman
4. **[Phase 3]** Create UI directory structure
5. **[Phase 3]** Implement API client module
6. **[Phase 3]** Build basic HTML structure
7. **[Phase 3]** Add CSS styling
8. **[Phase 3]** Implement UI logic and event handlers
9. **[Phase 4]** Configure static file serving
10. **[Phase 5]** Add configuration handling

---

## Testing Checklist

- [ ] API key authentication works
- [ ] `GET /api/v1/entities?entityTypes=Poster` returns poster list
- [ ] Pagination works correctly
- [ ] Search returns relevant results
- [ ] Single poster retrieval works
- [ ] UI loads without errors
- [ ] Grid displays posters correctly
- [ ] Search from UI works
- [ ] Pagination controls function
- [ ] Detail view shows full metadata
- [ ] Error states handled gracefully

---

## Future Enhancements

1. **Image Thumbnails**: Display poster images from MinIO storage
2. **Relationship Graph**: Visualize poster-artist-venue relationships
3. **Advanced Filters**: Filter by date range, venue, artist
4. **Bulk Operations**: Select and export multiple posters
5. **Edit Mode**: Update poster metadata through UI
6. **Authentication**: User login for secure access
