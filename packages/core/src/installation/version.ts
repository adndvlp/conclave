declare global {
  const OPENCODE_VERSION: string
  const CONCLAVE_VERSION: string
  const OPENCODE_CHANNEL: string
  const CONCLAVE_CHANNEL: string
}

const version = typeof CONCLAVE_VERSION === "string" ? CONCLAVE_VERSION : typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
const channel = typeof CONCLAVE_CHANNEL === "string" ? CONCLAVE_CHANNEL : typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"

export const InstallationVersion = version
export const InstallationChannel = channel
export const InstallationLocal = InstallationChannel === "local"
