/**
 * Jenkins pipeline step: run A11yGate against a site you are authorized to test.
 *
 * a11yGate(url: 'https://staging.example.com/', crawl: 10, failOn: 'serious', formats: ['junit', 'sarif'])
 *
 * Parameters:
 *   url         (required) Start URL.
 *   crawl       Optional. true = crawl up to the CLI cap; a number = page count; omitted/false = start URL only.
 *   failOn      minor, moderate, serious (default), critical, or none.
 *   formats     List or comma-separated: junit, sarif, json, md. Default: junit,sarif,json,md.
 *   outDir      Report directory. Default: a11y-results.
 *   baseline    Optional fingerprint baseline file (from a11ygate baseline create).
 *   cli         Command that runs the A11yGate CLI. Default: npx --yes @qe-atlas/a11ygate
 *               Published 0.1.0 does not include scan/--format; use a source build
 *               (for example: node packages/cli/dist/cli.mjs) until those ship.
 *   image       Optional Docker image (Node agent alternative). The step runs inside docker.image(image).
 *   dockerArgs  Optional string passed to docker.image(...).inside(dockerArgs).
 *
 * Publishes JUnit (${outDir}/*.junit.xml), archives the report directory (HTML/SARIF/JSON/MD),
 * and sets the build to UNSTABLE when the CLI exits 1 (findings at or above fail-on),
 * SUCCESS on exit 0, and FAILURE on any other exit code.
 *
 * Automated testing only. Not a WCAG audit, certification or legal advice.
 */
def call(Map args = [:]) {
  if (!args?.url) {
    error('a11yGate: url is required')
  }

  def failOn = (args.failOn ?: 'serious').toString()
  def allowedFailOn = ['minor', 'moderate', 'serious', 'critical', 'none']
  if (!allowedFailOn.contains(failOn)) {
    error("a11yGate: failOn must be one of ${allowedFailOn.join(', ')}")
  }

  def formats = args.formats ?: ['junit', 'sarif', 'json', 'md']
  if (formats instanceof CharSequence) {
    formats = formats.toString().split(',').collect { it.trim() }.findAll { it }
  }
  def allowedFormats = ['junit', 'sarif', 'json', 'md']
  formats.each { format ->
    if (!allowedFormats.contains(format.toString())) {
      error("a11yGate: unknown format '${format}'. Use junit, sarif, json, or md.")
    }
  }

  def outDir = (args.outDir ?: 'a11y-results').toString()
  def cli = (args.cli ?: 'npx --yes @qe-atlas/a11ygate').toString()

  def crawlArg = ''
  if (args.containsKey('crawl') && args.crawl != null && args.crawl != false) {
    crawlArg = (args.crawl == true) ? ' --crawl' : " --crawl ${args.crawl}"
  }

  def formatArg = formats ? " --format ${formats.join(',')} --out-dir '${outDir}'" : " --out-dir '${outDir}'"
  // Quote a baseline path as shell data, just as the init-generated fixed path is passed.
  def baselineArg = args.baseline ? " --baseline '" + args.baseline.toString().replace("'", "'\\''") + "'" : ''
  def command = "${cli} scan '${args.url}'${crawlArg} --fail-on ${failOn}${baselineArg}${formatArg}"

  def runScan = {
    def status = sh(script: command, returnStatus: true)
    junit allowEmptyResults: true, testResults: "${outDir}/*.junit.xml"
    archiveArtifacts artifacts: "${outDir}/**", allowEmptyArchive: true
    if (status == 0) {
      return status
    }
    if (status == 1) {
      unstable('A11yGate found issues at or above the fail-on level. Automated testing only. Not a WCAG audit, certification or legal advice.')
      return status
    }
    error("A11yGate failed to run (exit ${status}).")
  }

  if (args.image) {
    docker.image(args.image.toString()).inside(args.dockerArgs ? args.dockerArgs.toString() : '') {
      runScan()
    }
  } else {
    runScan()
  }
}
