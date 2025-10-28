# API Reference

Base URL: `https://<api-id>.execute-api.us-east-1.amazonaws.com/prod/`

## Endpoints

### POST /build

Start a new autonomous build.

**Request:**
```json
{
  "task": "Build a REST API for user management",
  "mode": "new_project",
  "max_iterations": 3
}
```

**Response:**
```json
{
  "build_id": "uuid",
  "status": "initiated",
  "message": "Build started"
}
```

### GET /build/{id}

Get build status and details.

**Response:**
```json
{
  "build_id": "uuid",
  "task": "...",
  "status": "testing|passed|failed|self_healing",
  "current_iteration": 1,
  "scout_output": {...},
  "architect_output": {...},
  "builder_output": {...},
  "tester_output": {...},
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp"
}
```

### GET /builds

List all builds with optional filtering.

**Query Parameters:**
- `status`: Filter by status (passed, failed, testing, etc.)

**Response:**
```json
{
  "builds": [...],
  "count": 10
}
```

### GET /build/{id}/logs

Get build logs.

**Response:**
```json
{
  "logs": "..."
}
```

### POST /build/{id}/cancel

Cancel a running build.

**Response:**
```json
{
  "message": "Build cancelled"
}
```

## Status Values

- `initiated`: Build created, waiting to start
- `scouting`: Analyzing requirements
- `architecting`: Designing system
- `building`: Generating code
- `testing`: Running tests
- `self_healing`: Fixing failures, will retry
- `passed`: All tests passed, deployment complete
- `failed`: Tests failed after max iterations
