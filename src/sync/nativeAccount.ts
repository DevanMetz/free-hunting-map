import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativeAccountPlugin {
  signIn(options: { serverClientId: string }): Promise<{ credential?: string }>;
}

const plugin = registerPlugin<NativeAccountPlugin>('NativeAccount');

export const usesNativeAccount = (): boolean => Capacitor.getPlatform() === 'android';

export async function nativeGoogleCredential(serverClientId: string): Promise<string> {
  const result = await plugin.signIn({ serverClientId });
  if (!result.credential) throw new Error('Sign-in unavailable');
  return result.credential;
}
