// Server hosts - can be overridden via environment variables for custom networks
export const SERVER_HOSTS = {
  DEFAULT_FILE_SERVER: process.env.LUX_FILE_SERVER || 'filev2.getsession.org',
  NETWORK_SERVER: process.env.LUX_NETWORK_SERVER || 'networkv1.getsession.org',
  PRO_SERVER: process.env.LUX_PRO_SERVER || 'not_set_yet',
};
