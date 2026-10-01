// Only M79 avoids the synchronous multi-MiB mutant matrix; normal baseline/scaling remain unchanged.
export const M79_FILE = 'tests/unit/jwt-work-budget.test.ts';
export const M79_NAME = 'M79 JWT scanner bounded character work';
export const M79_ARGS = [M79_FILE, '--testNamePattern', '^'+M79_NAME+'$'];
/** Exact native reporter identity/count/status; missing/zero/skipped/wrong/extra/error reports fail closed. */
export function validM79Selection(report, code) {
  if (!report || typeof report !== 'object' || ![0,1].includes(code)) return false;
  if (report.numTotalTests!==1 || report.numPendingTests!==0 || report.numTodoTests!==0 || !Array.isArray(report.testResults) || report.testResults.length!==1) return false;
  const file=report.testResults[0];
  if (typeof file.name!=='string' || !file.name.replaceAll('\\','/').endsWith('/'+M79_FILE) || !Array.isArray(file.assertionResults) || file.assertionResults.length!==1) return false;
  const test=file.assertionResults[0];
  if (test.fullName!==M79_NAME || test.title!==M79_NAME) return false;
  if (code===0) return report.success===true && report.numPassedTests===1 && report.numFailedTests===0 && file.status==='passed' && test.status==='passed' && Array.isArray(test.failureMessages) && test.failureMessages.length===0;
  return report.success===false && report.numPassedTests===0 && report.numFailedTests===1 && file.status==='failed' && test.status==='failed' && Array.isArray(test.failureMessages) && test.failureMessages.length>0;
}
