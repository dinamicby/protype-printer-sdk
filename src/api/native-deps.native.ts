/**
 * Optional React Native native dependencies — React Native (Metro) build.
 *
 * Metro resolves this `.native.ts` variant over `native-deps.ts`. react-native
 * is always present in an RN app, so it's imported statically (bundled). Both
 * requires are literal specifiers — Metro rejects dynamic `require(id)`.
 */
import { NativeModules as RNNativeModules, Platform as RNPlatform } from 'react-native';

let rnfs: any;
try {
  // Literal require so Metro can resolve/bundle it; try/catch keeps a missing
  // optional dep from throwing at runtime.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  rnfs = require('react-native-fs')?.default;
} catch {
  rnfs = undefined;
}

export const NativeModules: any = RNNativeModules;
export const Platform: any = RNPlatform;
export const RNFS: any = rnfs;
