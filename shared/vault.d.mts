export interface LockedFile<Info = Record<string, unknown>> {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
  info: Info;
}
export function lock<Info>(value: unknown, passphrase: string, info?: Info): Promise<LockedFile<Info>>;
export function unlock<T>(file: LockedFile<unknown>, passphrase: string): Promise<T>;
