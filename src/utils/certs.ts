import getMacCertificates from './mac-ca';

export default async function *getSystemCertificates(): AsyncIterable<string> {
  yield * getMacCertificates();
}
  