/** Check capture separately from the browser's remote speech service. */
export async function checkMicrophone(): Promise<() => void> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw new Error('Microphone access requires HTTPS or localhost.');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return () => stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    throw microphoneFailure(error);
  }
}

/** Returns device-specific recovery steps when opening microphone input fails. */
export function microphoneFailure(error: unknown): Error {
  const name = error instanceof DOMException ? error.name : '';
  return new Error(
    name === 'NotAllowedError'
      ? 'Microphone access was denied. Allow microphone access for this site and browser in your system settings, then try again. If this is a school browser, ask IT to allow microphone access for this site.'
      : name === 'NotFoundError'
        ? 'No microphone was found. Connect a microphone, then try again.'
        : name === 'NotReadableError'
          ? 'The microphone is busy or unavailable. Close other recording apps, then try again.'
          : 'The microphone could not be opened. Check your input device and permissions, then try again.',
  );
}
