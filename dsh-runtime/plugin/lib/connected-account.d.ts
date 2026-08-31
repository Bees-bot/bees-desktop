export class ConnectedAccount {
  constructor(database: any, credentials: any, baseUrl?: string, logger?: any);
  accounts(): Array<{ userId: string; email: string; name: string }>;
  connections(): any[];
  publicAccount(): { userId: string; email: string; name: string } | null;
  authConfig(): Promise<any>;
  resumeSession(token: string, knownUser?: any): Promise<any>;
  signIn(email: string, password: string): Promise<any>;
  signUp(name: string, email: string, password: string): Promise<any>;
  signOut(userId?: string): Promise<void>;
  sync(): Promise<any[]>;
  syncCoordination(connectionIds?: string[] | null): Promise<any[]>;
  createOrganization(name: string, accountUserId: string): Promise<any>;
  createTeam(name: string, connectionId: string): Promise<any>;
  executionClaims(): any;
  close(): Promise<void>;
  summary(): Promise<any>;
  command(input: Record<string, any>): Promise<any>;
}
