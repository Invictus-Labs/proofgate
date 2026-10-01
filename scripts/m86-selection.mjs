// Only M86 avoids the synchronous multi-MiB mutant matrix; normal baseline/scaling remain unchanged.
export const M86_FILE = 'tests/unit/redacted-key-work-budget.test.ts';
export const M86_NAME = 'M86 redacted key collisions bounded candidate work';
export const M86_ARGS = [M86_FILE, '--testNamePattern', '^'+M86_NAME+'$'];
/** Exact native reporter identity/count/status; missing/zero/skipped/wrong/extra/error reports fail closed. */
export function validM86Selection(report, code) {
  if (!report || typeof report !== 'object' || ![0,1].includes(code)) return false;
  if (report.numTotalTests!==1 || report.numPendingTests!==0 || report.numTodoTests!==0 || !Array.isArray(report.testResults) || report.testResults.length!==1) return false;
  const file=report.testResults[0];
  if (typeof file.name!=='string' || !file.name.replaceAll('\\','/').endsWith('/'+M86_FILE) || !Array.isArray(file.assertionResults) || file.assertionResults.length!==1) return false;
  const test=file.assertionResults[0];
  if (test.fullName!==M86_NAME || test.title!==M86_NAME) return false;
  if (code===0) return report.success===true && report.numPassedTests===1 && report.numFailedTests===0 && file.status==='passed' && test.status==='passed' && Array.isArray(test.failureMessages) && test.failureMessages.length===0;
  return report.success===false && report.numPassedTests===0 && report.numFailedTests===1 && file.status==='failed' && test.status==='failed' && Array.isArray(test.failureMessages) && test.failureMessages.length>0;
}
