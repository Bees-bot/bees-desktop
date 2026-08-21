export class ConnectedAccount {
  constructor(database: any, credentials: any, baseUrl?: string);
  publicAccount(): { userId: string; email: string; name: string } | null;
  signIn(email: string, password: string): Promise<any>;
  signUp(name: string, email: string, password: string): Promise<any>;
  signOut(): Promise<void>;
  sync(): Promise<any[]>;
  summary(): Promise<any>;
  command(input: Record<string, any>): Promise<any>;
}
