import { SourceOGError, SOURCEOG_ERROR_CODES, type StabilityLevel } from "@sourceog/runtime";

export type AutomationEventName =
  | "build.complete"
  | "build.failed"
  | "request.complete"
  | "policy.violation"
  | "revalidate.complete";

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

export function defineSchedule(schedule: AutomationSchedule): AutomationSchedule {
  if (schedule.kind === "interval" && (!schedule.intervalMinutes || schedule.intervalMinutes <= 0)) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.AUTOMATION_INVALID,
      "Interval schedules must declare a positive intervalMinutes value."
    );
  }

  return schedule;
}

export function defineAutomation<TPayload extends Record<string, unknown> = Record<string, unknown>>(automation: SourceOGAutomation<TPayload>): SourceOGAutomation<TPayload> {
  if ((!automation.events || automation.events.length === 0) && !automation.schedule) {
    throw new SourceOGError(
      SOURCEOG_ERROR_CODES.AUTOMATION_INVALID,
      `Automation "${automation.name}" must define at least one event or a schedule.`
    );
  }

  return automation;
}

export function defineWorkflow<TPayload extends Record<string, unknown> = Record<string, unknown>>(automation: SourceOGAutomation<TPayload>): SourceOGAutomation<TPayload> {
  return defineAutomation(automation);
}

export function createAutomationManifest(automations: SourceOGAutomation[]): AutomationManifest {
  return {
    version: "2027.1",
    generatedAt: new Date().toISOString(),
    automations: automations.map((automation) => ({
      name: automation.name,
      stability: automation.stability ?? "stable",
      events: automation.events ?? [],
      schedule: automation.schedule
    }))
  };
}

export class AutomationEngine {
  public constructor(private readonly automations: SourceOGAutomation[]) {}

  public async dispatch<TPayload extends Record<string, unknown>>(event: AutomationEvent<TPayload>): Promise<AutomationResult[]> {
    const results: AutomationResult[] = [];
    for (const automation of this.automations) {
      if (automation.events && !automation.events.includes(event.name)) {
        continue;
      }

      const result = await automation.run({
        event,
        emitDiagnostic(message, details) {
          results.push({
            automation: automation.name,
            status: "completed",
            message: `${message}${details ? ` ${JSON.stringify(details)}` : ""}`
          });
        }
      });

      results.push(result ?? {
        automation: automation.name,
        status: "completed"
      });
    }
    return results;
  }
}
