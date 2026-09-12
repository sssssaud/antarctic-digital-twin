import { Schema, model, type HydratedDocument } from 'mongoose';
import { STATION_CODES, type StationCode, type StationStatus } from '../telemetry-engine';

export interface StationDoc {
  code: StationCode;
  name: string;
  region: string;
  coordinates: { latitude: number; longitude: number };
  commissionedYear: number;
  crewCapacity: number;
  generatorCapacityKw: number;
  dieselCapacityL: number;
  waterCapacityL: number;
  status: StationStatus;
  lastContactAt: Date;
}

const stationSchema = new Schema<StationDoc>(
  {
    code: { type: String, required: true, unique: true, enum: STATION_CODES },
    name: { type: String, required: true, trim: true },
    region: { type: String, required: true, trim: true },
    coordinates: {
      latitude: { type: Number, required: true, min: -90, max: 90 },
      longitude: { type: Number, required: true, min: -180, max: 180 },
    },
    commissionedYear: { type: Number, required: true, min: 1900 },
    crewCapacity: { type: Number, required: true, min: 1 },
    generatorCapacityKw: { type: Number, required: true, min: 1 },
    dieselCapacityL: { type: Number, required: true, min: 1 },
    waterCapacityL: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      required: true,
      enum: ['nominal', 'degraded', 'critical'],
      default: 'nominal',
    },
    lastContactAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, versionKey: false },
);

export type StationDocument = HydratedDocument<StationDoc>;
export const Station = model<StationDoc>('Station', stationSchema);
