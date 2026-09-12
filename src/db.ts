/**
 * In-memory MongoDB lifecycle.
 *
 * `mongodb-memory-server` spawns a real mongod against an ephemeral data
 * directory, so judges need no local MongoDB install and no connection string.
 * The trade-off is deliberate and documented: all data is discarded on exit.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

export const DB_NAME = 'antarctic_twin';

let memoryServer: MongoMemoryServer | null = null;

/** Boot the in-memory server and connect mongoose to it. Returns the URI used. */
export async function connectDatabase(): Promise<string> {
  if (memoryServer) return memoryServer.getUri();

  memoryServer = await MongoMemoryServer.create({ instance: { dbName: DB_NAME } });
  const uri = memoryServer.getUri();

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName: DB_NAME, serverSelectionTimeoutMS: 20_000 });

  return uri;
}

/** Tear everything down — used by the graceful shutdown path. */
export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
