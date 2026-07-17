/**
 * Optional React Native native dependencies — base (non-RN) build.
 *
 * Non-RN bundlers (Vite/webpack, Node) resolve THIS file and get inert stubs,
 * so the SDK builds without react-native / react-native-fs installed. React
 * Native's Metro resolves the `native-deps.native.ts` sibling instead, which
 * statically imports the real modules (a dynamic `require(id)` is rejected by
 * Metro, which is why the previous requireOptional approach broke the RN build).
 */
export const NativeModules: any = undefined;
export const Platform: any = undefined;
export const RNFS: any = undefined;
