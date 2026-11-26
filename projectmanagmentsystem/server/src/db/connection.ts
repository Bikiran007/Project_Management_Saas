import mongoose from 'mongoose';
import { env } from '../config/env.js';

export async function connectDB(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  if (!uri) {
    console.error('FATAL: MONGODB_URI environment variable is not defined.');
    process.exit(1);
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  try {
    mongoose.set('strictQuery', true);
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`[MongoDB] Connected successfully to database: ${conn.connection.name} at ${conn.connection.host}`);
    return conn;
  } catch (err) {
    console.error(`\n======================================================`);
    console.error(`FATAL DATABASE ERROR: Could not connect to MongoDB.`);
    console.error(`Connection URI: ${uri.replace(/\/\/[^@]+@/, '//***:***@')}`);
    console.error(`Error details: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`Please verify that MongoDB is running locally or that MONGODB_URI is valid.`);
    console.error(`======================================================\n`);
    throw err;
  }
}

export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
