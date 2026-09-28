export class ConnectedAccount {
  constructor(database: any, credentials: any, baseUrl?: string, logger?: any);
  accounts(): Array<{ userId: string; email: string; name: string; enabled: boolean }>;
  connections(): any[];
  publicAccount(): { userId: string; email: string; name: string } | null;
  authConfig(): Promise<any>;
  resumeSession(token: string, knownUser?: any): Promise<any>;
  signIn(email: string, password: string): Promise<any>;
  signUp(name: string, email: string, password: string): Promise<any>;
  signOut(userId?: string): Promise<void>;
  setAccountEnabled(userId: string, enabled: boolean): Promise<any>;
  claimScope(teamId: string, accountUserId?: string): any;
  sync(records?: boolean): Promise<any[]>;
  syncCoordination(): Promise<any[]>;
  createOrganization(name: string, accountUserId: string): Promise<any>;
  deleteOrganization(organizationId: string, connectionId: string): Promise<any>;
  createTeam(name: string, connectionId: string): Promise<any>;
  executionClaims(): any;
  listProcessQuestions(teamId: string): Promise<any[]>;
  listProcessExecutions(teamId: string): Promise<any[]>;
  askProcessQuestion(teamId: string, input: Record<string, any>): Promise<any>;
  answerProcessQuestion(teamId: string, id: string, answer: string): Promise<any>;
  close(): Promise<void>;
  summary(): Promise<any>;
  command(input: Record<string, any>): Promise<any>;
}
