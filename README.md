# dexie-worker

dexie-worker is an extension package for <a href="https://dexie.org/" target="_blank">Dexie.js</a> that enables Dexie to work seamlessly in a Web Worker environment, allowing for smoother handling of IndexedDB operations without blocking the main thread. This package provides an easy way to enhance your Dexie-based applications with Web Worker support, along with a convenient React hook for live query subscriptions.

## Features

- **Web Worker Integration**: Run Dexie.js in a Web Worker to improve app performance and responsiveness.
- **React Hook Support**: Use `useLiveQuery` to fetch and subscribe to live data changes, optimized for a Web Worker context.

## Installation

Install the package via npm:

```bash
npm install dexie-worker
```

## Usage

To get started with dexie-worker, import `getWebWorkerDB` to set up Dexie in a Web Worker context and enjoy a non-blocking database experience.

### Basic Setup

1. Define Your Dexie Database: Create a Dexie subclass or use a function-based approach to define your database schema.
2. Initialize with Web Worker: Use `getWebWorkerDB` to enable Web Worker functionality for your Dexie instance.

#### Example 1: Function-Based Dexie Database

Here’s a basic setup for integrating dexie-worker in your Dexie project using a function-based approach:

```javascript
import Dexie from "dexie";
import { getWebWorkerDB } from "dexie-worker";

// Define a function-based Dexie instance
function createDatabase() {
  const db = new Dexie("MyDatabase");
  db.version(1).stores({
    products: "++id, name"
  });
  return db;
}

// Initialize with Web Worker DB insance
const db = getWebWorkerDB(createDatabase());
```

Now, `db` will run on a separate thread, keeping your main UI thread responsive and free from database-related tasks.

#### Example 2: Class-Based Dexie Database

Alternatively, you can integrate `dexie-worker` in your Dexie project with a class-based approach.

```javascript
import Dexie from "dexie";
import { getWebWorkerDB } from "dexie-worker";

// Define your Dexie subclass
class MyDatabase extends Dexie {
  constructor() {
    super("MyDatabase");
    this.version(1).stores({
      users: "++id, name"
    });
  }
}

// Initialize with Web Worker support
const db = getWebWorkerDB(new MyDatabase());
```

With this setup, you're free to use a function-based approach to organize and create multiple Dexie instances or handle conditional setups within your application.

### React Hook: useLiveQuery

dexie-worker also provides a convenient `useLiveQuery` hook for React applications, which allows you to subscribe to live query updates from the database.

> ⚠️ **Warning**: Unlike the default usage in `dexie-react-hooks`, you'll need to pass the `db` instance within the callback function.

#### Usage Example

```javascript
import { useLiveQuery } from "dexie-worker";

// IMPORTANT: use "db" returned from the callback function
const userDetails = useLiveQuery((db) => db.users.get({ id: 1 }));

// userDetails will automatically update when data changes
```

By wrapping `db` in the callback function, `useLiveQuery` efficiently maintains real-time updates in your React components, utilizing the Web Worker's isolated environment.

### Custom Live Queries
For advanced usage, dexie-worker exports the liveQuery function, allowing you to create your own custom live queries outside of React components.
#### Example of a Custom Live Query
```js
import { liveQuery } from "dexie-worker";

// Create a custom live query
const userLiveData = liveQuery(() => db.users.where("age").above(18).toArray());

// Subscription to the live query
userLiveData.subscribe({
  next: (data) => console.log("User data updated:", data),
  error: (error) => console.error("Live query error:", error),
});
```

## API

### getWebWorkerDB(dbInstance)

- **Description**: Converts a Dexie instance to run in a Web Worker.
- **Parameters**:
  - `dbInstance`: An instance of your Dexie subclass or function-based instance.
- **Returns**: A Web Worker-enabled Dexie instance.

### useLiveQuery(queryCallback)

- **Description**: React hook for live queries on Dexie. Optimized for Web Worker integration.
- **Parameters**:
  - `queryCallback`: A callback function to execute the query, taking `db` as an argument.
- **Returns**: The result of the query, updating automatically with data changes.

### liveQuery(queryCallback)

- **Description**:  A function for setting up custom live queries with automatic updates.
- **Parameters**:
  - `queryCallback`: A callback function defining the query logic.
- **Returns**: A subscribable that emits updates when the query result changes.

## Compatibility

- Dexie.js v3.0+
- React v16.8+ (if using `useLiveQuery`)

## License

MIT

## Contribution

Feel free to contribute to the project by creating issues or pull requests. Contributions, bug reports, and feature requests are welcome!