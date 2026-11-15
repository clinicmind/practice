/**
 * `clientId` and `createdAt` are optional and only used when importing local
 * records into the cloud store: the same clientId saved twice is one record.
 */
export type ImportFields = { clientId?: string; createdAt?: string };
type AttemptBase = { itemId: string; response: string; criteriaMet: boolean[] }; // length 3
type DecisionBase = { sessionId: string; decisionId: string; optionId?: string; response?: string };
type ReflectionBase = { moduleSlug: string; promptId: string; text: string };
export type NewAttempt = AttemptBase & ImportFields;
export type Attempt = AttemptBase & { id: string; createdAt: string };
export type NewDecision = DecisionBase & ImportFields;
export type Decision = DecisionBase & { id: string; createdAt: string };
export type NewReflection = ReflectionBase & ImportFields;
export type Reflection = ReflectionBase & { id: string; createdAt: string };

export interface ProgressStore {
  saveAttempt(a: NewAttempt): Promise<Attempt>;
  listAttempts(itemId?: string): Promise<Attempt[]>;
  saveDecision(d: NewDecision): Promise<Decision>;
  listDecisions(sessionId?: string): Promise<Decision[]>;
  saveReflection(r: NewReflection): Promise<Reflection>;
  listReflections(moduleSlug?: string): Promise<Reflection[]>;
}
