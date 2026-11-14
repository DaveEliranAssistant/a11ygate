import com.lesfurets.jenkins.unit.BasePipelineTest
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

import static org.junit.jupiter.api.Assertions.assertEquals
import static org.junit.jupiter.api.Assertions.assertThrows
import static org.junit.jupiter.api.Assertions.assertTrue

class A11yGateTest extends BasePipelineTest {
  def script
  Integer nextExit = 0
  String lastSh
  Map lastJunit
  Map lastArchive
  String lastUnstable
  def dockerInside

  @Override
  @BeforeEach
  void setUp() {
    super.setUp()
    lastSh = null
    lastJunit = null
    lastArchive = null
    lastUnstable = null
    dockerInside = null
    nextExit = 0

    helper.registerAllowedMethod('sh', [Map.class], { Map args ->
      lastSh = args.script as String
      return nextExit
    })
    helper.registerAllowedMethod('junit', [Map.class], { Map args -> lastJunit = args })
    helper.registerAllowedMethod('archiveArtifacts', [Map.class], { Map args -> lastArchive = args })
    helper.registerAllowedMethod('unstable', [String.class], { String message ->
      lastUnstable = message
      binding.getVariable('currentBuild').result = 'UNSTABLE'
    })
    helper.registerAllowedMethod('error', [String.class], { String message ->
      throw new IllegalStateException(message)
    })

    def inside = { String _args, Closure body ->
      dockerInside = true
      body.delegate = script
      body.call()
    }
    def image = { String _name -> [inside: inside] }
    binding.setVariable('docker', [image: image])
    binding.setVariable('currentBuild', new Expando(result: null))

    script = loadScript('vars/a11yGate.groovy')
  }

  @Test
  void requiresUrl() {
    def error = assertThrows(Exception) { script.call([:]) }
    assertTrue(error.message.contains('url is required'))
  }

  @Test
  void rejectsUnknownFailOn() {
    def error = assertThrows(Exception) { script.call([url: 'http://127.0.0.1/', failOn: 'high']) }
    assertTrue(error.message.contains('failOn'))
  }

  @Test
  void rejectsUnknownFormat() {
    def error = assertThrows(Exception) { script.call([url: 'http://127.0.0.1/', formats: ['xml']]) }
    assertTrue(error.message.contains('unknown format'))
  }

  @Test
  void successPublishesJunitAndArchivesArtifacts() {
    nextExit = 0
    script.call([
      url: 'http://127.0.0.1:4173/',
      crawl: 10,
      failOn: 'serious',
      formats: ['junit', 'sarif'],
      cli: 'node packages/cli/dist/cli.mjs',
      outDir: 'a11y-results'
    ])
    assertTrue(lastSh.contains("node packages/cli/dist/cli.mjs scan 'http://127.0.0.1:4173/' --crawl 10 --fail-on serious --format junit,sarif --out-dir 'a11y-results'"))
    assertEquals(true, lastJunit.allowEmptyResults)
    assertEquals('a11y-results/*.junit.xml', lastJunit.testResults.toString())
    assertEquals('a11y-results/**', lastArchive.artifacts.toString())
    assertEquals(null, lastUnstable)
    assertEquals(null, binding.getVariable('currentBuild').result)
  }

  @Test
  void findingsSetUnstableFromFailOnExitCode() {
    nextExit = 1
    script.call([url: 'http://127.0.0.1:4173/', formats: 'junit'])
    assertEquals('UNSTABLE', binding.getVariable('currentBuild').result)
    assertTrue(lastUnstable.contains('Automated testing only. Not a WCAG audit, certification or legal advice.'))
    assertTrue(lastSh.contains('--fail-on serious'))
    assertTrue(lastSh.contains('--format junit'))
  }

  @Test
  void commaSeparatedFormatsTrimWhitespaceAndDropEmptyEntries() {
    script.call([url: 'http://127.0.0.1/', formats: ' junit, , sarif '])
    assertTrue(lastSh.contains('--format junit,sarif'))
  }

  @Test
  void setupErrorFailsTheBuild() {
    nextExit = 2
    def error = assertThrows(Exception) { script.call([url: 'http://127.0.0.1:4173/']) }
    assertTrue(error.message.contains('exit 2'))
  }

  @Test
  void crawlTrueAndImageAreAccepted() {
    nextExit = 0
    script.call([url: 'http://127.0.0.1:4173/', crawl: true, image: 'node:22', formats: ['junit']])
    assertTrue(lastSh.contains(' --crawl --fail-on'))
    assertEquals(true, dockerInside)
  }

  @Test
  void optionalBaselineIsPassedAsShellData() {
    script.call([url: 'http://127.0.0.1/', baseline: '.a11ygate-baseline.json'])
    assertTrue(lastSh.contains(" --baseline '.a11ygate-baseline.json'"))
    script.call([url: 'http://127.0.0.1/', baseline: "reviewer's baseline.json"])
    assertTrue(lastSh.contains(" --baseline 'reviewer'\\''s baseline.json'"))
  }

  // Execute the actual init snapshots through JenkinsPipelineUnit's mocked declarative DSL.
  // Library resolution is configured by the Jenkins administrator; the library step itself
  // is loaded by setUp(), so strip only that controller-side annotation here.
  private void runGeneratedPipeline(String fixture) {
    binding.setVariable('any', 'any')
    binding.setVariable('params', [SITE_URL: 'http://127.0.0.1:4173/', FAIL_ON: 'serious'])
    ['pipeline', 'options', 'parameters', 'stages', 'steps', 'post', 'always', 'timestamps'].each { name ->
      helper.registerAllowedMethod(name, [Closure.class], { Closure body -> body.call() })
    }
    helper.registerAllowedMethod('agent', [String.class], { String ignored -> })
    helper.registerAllowedMethod('timestamps', [], { -> })
    helper.registerAllowedMethod('stage', [String.class, Closure.class], { String ignored, Closure body -> body.call() })
    helper.registerAllowedMethod('string', [Map.class], { Map ignored -> })
    helper.registerAllowedMethod('choice', [Map.class], { Map ignored -> })
    helper.registerAllowedMethod('echo', [String.class], { String ignored -> })
    helper.registerAllowedMethod('a11yGate', [Map.class], { Map args -> script.call(args) })
    def source = new File('../../tests/fixtures/init/jenkins/' + fixture).text
    assertTrue(source.contains("@Library('a11ygate') _"))
    loadInlineScript(source.replace("@Library('a11ygate') _", '')).run()
  }

  @Test
  void generatedInitJenkinsfileRunsWithSharedLibraryAndPublishesReports() {
    runGeneratedPipeline('Jenkinsfile')
    assertTrue(lastSh.contains("scan 'http://127.0.0.1:4173/' --crawl 10 --fail-on serious --format junit,sarif,json,md"))
    assertEquals('a11y-results/*.junit.xml', lastJunit.testResults.toString())
    assertEquals('a11y-results/**', lastArchive.artifacts.toString())
  }

  @Test
  void generatedInitBaselineJenkinsfileUsesFingerprintBaseline() {
    runGeneratedPipeline('Jenkinsfile.baseline')
    assertTrue(lastSh.contains(" --baseline '.a11ygate-baseline.json'"))
    assertEquals('a11y-results/*.junit.xml', lastJunit.testResults.toString())
  }

}
