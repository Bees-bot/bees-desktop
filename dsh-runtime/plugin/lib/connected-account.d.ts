export class ConnectedAccount {
  constructor(database: any, credentials: any, baseUrl?: string, logger?: any);
  publicAccount(): { userId: string; email: string; name: string } | null;
  signIn(email: string, password: string): Promise<any>;
  signUp(name: string, email: string, password: string): Promise<any>;
  signOut(): Promise<void>;
  sync(): Promise<any[]>;
  syncCoordination(organizationIds?: string[] | null): Promise<any[]>;
  executionClaims(): any;
  close(): Promise<void>;
  summary(): Promise<any>;
  command(input: Record<string, any>): Promise<any>;
}
