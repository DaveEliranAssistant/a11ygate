import jenkins.model.Jenkins
import hudson.model.ParametersDefinitionProperty
import hudson.model.StringParameterDefinition
import org.jenkinsci.plugins.workflow.job.WorkflowJob
import org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition

// Execute the unmodified example, including @Library and the real shared step.
// Seed parameters before the first build (Declarative normally adds them then).
['bad': 4173, 'clean': 4174].each { fixture, port ->
  def job = Jenkins.get().createProject(WorkflowJob, fixture)
  job.addProperty(new ParametersDefinitionProperty(
    new StringParameterDefinition('SITE_URL', "http://127.0.0.1:${port}/"),
    new StringParameterDefinition('FAIL_ON', 'serious')
  ))
  job.definition = new CpsFlowDefinition(new File('/opt/a11ygate/examples/jenkins/Jenkinsfile').text, true)
  job.save()
  // Only packages is needed in the job workspace. Its CLI and runtime peers live
  // in the immutable source tree. Each job writes its own fresh report directory.
  def workspace = new File(Jenkins.get().rootDir, "workspace/${fixture}")
  workspace.mkdirs()
  java.nio.file.Files.createSymbolicLink(new File(workspace, 'packages').toPath(), new File('/opt/a11ygate/packages').toPath())
}
