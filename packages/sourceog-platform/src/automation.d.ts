import { type StabilityLevel } from "@sourceog/runtime";
export type AutomationEventName = "build.complete" | "build.failed" | "request.complete" | "policy.violation" | "revalidate.complete";
export interface AutomationEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
    name: AutomationEventName;
    payload: TPayload;
    timestamp: string;
}
export interface AutomationSchedule {
    kind: "manual" | "interval";
    intervalMinutes?: number;
}
export interface AutomationContext<TPayload extends Record<string, unknown> = Record<string, unknown>> {
    event: AutomationEvent<TPayload>;
    emitDiagnostic(message: string, details?: Record<string, unknown>): void;
}
export interface AutomationResult {
    automation: string;
    status: "completed" | "skipped" | "failed";
    message?: string;
}
export interface SourceOGAutomation<TPayload extends Record<string, unknown> = Record<string, unknown>> {
    name: string;
    stability?: StabilityLevel;
    events?: AutomationEventName[];
    schedule?: AutomationSchedule;
    run(context: AutomationContext<TPayload>): Promise<AutomationResult | void> | AutomationResult | void;
}
export interface AutomationManifestEntry {
    name: string;
    stability: StabilityLevel;
    events: AutomationEventName[];
    schedule?: AutomationSchedule;
}
export interface AutomationManifest {
    version: string;
    generatedAt: string;
    automations: AutomationManifestEntry[];
}
export declare function defineSchedule(schedule: AutomationSchedule): AutomationSchedule;
export declare function defineAutomation<TPayload extends Record<string, unknown> = Record<string, unknown>>(automation: SourceOGAutomation<TPayload>): SourceOGAutomation<TPayload>;
export declare function defineWorkflow<TPayload extends Record<string, unknown> = Record<string, unknown>>(automation: SourceOGAutomation<TPayload>): SourceOGAutomation<TPayload>;
export declare function createAutomationManifest(automations: SourceOGAutomation[]): AutomationManifest;
export declare class AutomationEngine {
    private readonly automations;
    constructor(automations: SourceOGAutomation[]);
    dispatch<TPayload extends Record<string, unknown>>(event: AutomationEvent<TPayload>): Promise<AutomationResult[]>;
}
