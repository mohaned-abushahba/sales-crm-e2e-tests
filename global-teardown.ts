import buildDriftReport from './utils/drift-report';

export default function globalTeardown() {
  buildDriftReport();
}
