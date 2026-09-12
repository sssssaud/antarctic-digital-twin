import { Schema, model, type HydratedDocument } from 'mongoose';
import { STATION_CODES, type Reading, type StationCode } from '../telemetry-engine';

export interface TelemetryDoc extends Reading {
  stationCode: StationCode;
  recordedAt: Date;
}

/** Sub-documents carry no _id of their own — they are value objects. */
const subDoc = { _id: false } as const;

const environmentSchema = new Schema(
  {
    temperatureC: { type: Number, required: true },
    windChillC: { type: Number, required: true },
    windSpeedKts: { type: Number, required: true, min: 0 },
    windGustKts: { type: Number, required: true, min: 0 },
    humidityPct: { type: Number, required: true, min: 0, max: 100 },
    visibilityM: { type: Number, required: true, min: 0 },
    pressureHpa: { type: Number, required: true, min: 0 },
    snowDepthCm: { type: Number, required: true, min: 0 },
    blizzard: { type: Boolean, required: true, default: false },
  },
  subDoc,
);

const energySchema = new Schema(
  {
    dieselLevelPct: { type: Number, required: true, min: 0, max: 100 },
    dieselLitres: { type: Number, required: true, min: 0 },
    generatorLoadKw: { type: Number, required: true, min: 0 },
    generatorCapacityKw: { type: Number, required: true, min: 0 },
    solarOutputKw: { type: Number, required: true, min: 0 },
    windOutputKw: { type: Number, required: true, min: 0 },
    batterySocPct: { type: Number, required: true, min: 0, max: 100 },
    demandKw: { type: Number, required: true, min: 0 },
  },
  subDoc,
);

const infrastructureSchema = new Schema(
  {
    hvacStatus: { type: String, required: true, enum: ['nominal', 'strained', 'fault'] },
    indoorTempC: { type: Number, required: true },
    waterReserveL: { type: Number, required: true, min: 0 },
    waterCapacityL: { type: Number, required: true, min: 0 },
    structuralIntegrityPct: { type: Number, required: true, min: 0, max: 100 },
    commsStatus: { type: String, required: true, enum: ['online', 'degraded', 'down'] },
    uplinkLatencyMs: { type: Number, required: true, min: 0 },
    wasteTankPct: { type: Number, required: true, min: 0, max: 100 },
  },
  subDoc,
);

const logisticsSchema = new Schema(
  {
    crewOnStation: { type: Number, required: true, min: 0 },
    crewCapacity: { type: Number, required: true, min: 0 },
    foodDaysRemaining: { type: Number, required: true, min: 0 },
    medicalKits: { type: Number, required: true, min: 0 },
    nextResupplyDays: { type: Number, required: true, min: 0 },
    pendingCargoTonnes: { type: Number, required: true, min: 0 },
  },
  subDoc,
);

const telemetrySchema = new Schema<TelemetryDoc>(
  {
    stationCode: { type: String, required: true, enum: STATION_CODES, index: true },
    recordedAt: { type: Date, required: true, default: () => new Date() },
    environment: { type: environmentSchema, required: true },
    energy: { type: energySchema, required: true },
    infrastructure: { type: infrastructureSchema, required: true },
    logistics: { type: logisticsSchema, required: true },
  },
  { versionKey: false },
);

// The dashboard and API only ever ask for "latest N for one station".
telemetrySchema.index({ stationCode: 1, recordedAt: -1 });

export type TelemetryDocument = HydratedDocument<TelemetryDoc>;
export const Telemetry = model<TelemetryDoc>('Telemetry', telemetrySchema);
