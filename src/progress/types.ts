export type NewAttempt = { itemId: string; response: string; criteriaMet: boolean[] }; // length 3
export type Attempt = NewAttempt & { id: string; createdAt: string };
export type NewDecision = { sessionId: string; decisionId: string; optionId?: string; response?: string };
export type Decision = NewDecision & { id: string; createdAt: string };
export type NewReflection = { moduleSlug: string; promptId: string; text: string };
export type Reflection = NewReflection & { id: string; createdAt: string };

export interface ProgressStore {
  saveAttempt(a: NewAttempt): Promise<Attempt>;
  listAttempts(itemId?: string): Promise<Attempt[]>;
  saveDecision(d: NewDecision): Promise<Decision>;
  listDecisions(sessionId?: string): Promise<Decision[]>;
  saveReflection(r: NewReflection): Promise<Reflection>;
  listReflections(moduleSlug?: string): Promise<Reflection[]>;
}
