targetScope = 'subscription'

// Force re-deployment after resource group deletion
@minLength(1)
@maxLength(64)
@description('Name of the environment (e.g., dev, prod)')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

@description('AI Agent endpoint (auto-discovered by preprovision hook)')
param aiAgentEndpoint string = ''

@description('AI Agent ID (configured via azd env set AI_AGENT_ID)')
param aiAgentId string = ''

@description('AI Foundry resource group name (auto-discovered by preprovision hook)')
param aiFoundryResourceGroup string = ''

@description('AI Foundry resource name (auto-discovered by preprovision hook)')
param aiFoundryResourceName string = ''

@description('Entra ID Client ID (set by azd hook)')
param entraSpaClientId string = ''

@description('Entra ID Tenant ID (set by azd hook or auto-detected)')
param entraTenantId string = tenant().tenantId

@description('Container image for web service (set by postprovision hook)')
param webImageName string = 'mcr.microsoft.com/k8se/quickstart:latest'  // Placeholder during initial provision

@description('Tags to apply to all resources')
param tags object = {}

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var defaultTags = {
  'azd-env-name': environmentName
  'app-name': 'ai-foundry-agent'
}

var combinedTags = union(tags, defaultTags)

// Create resource group
resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: '${abbrs.resourcesResourceGroups}${environmentName}'
  location: location
  tags: combinedTags
}

// Deploy infrastructure (ACR + Container Apps Environment)
module infrastructure 'main-infrastructure.bicep' = {
  name: 'infrastructure'
  scope: rg
  params: {
    location: location
    tags: combinedTags
    resourceToken: resourceToken
  }
}

// Deploy application (Container Apps + RBAC)
module app 'main-app.bicep' = {
  name: 'app'
  scope: rg
  params: {
    location: location
    tags: combinedTags
    resourceToken: resourceToken
    containerAppsEnvironmentId: infrastructure.outputs.containerAppsEnvironmentId
    containerRegistryName: infrastructure.outputs.containerRegistryName
    aiAgentEndpoint: aiAgentEndpoint
    aiAgentId: aiAgentId
    entraSpaClientId: entraSpaClientId
    entraTenantId: entraTenantId
    webImageName: webImageName
  }
}

// Assign Cognitive Services User role to web managed identity on AI Agent resource
module roleAssignment 'core/security/role-assignment.bicep' = {
  name: 'ai-agent-role-assignment'
  scope: resourceGroup(aiFoundryResourceGroup)
  params: {
    principalId: app.outputs.webIdentityPrincipalId
    roleDefinitionId: 'a97b65f3-24c7-4388-baec-2e87135dc908' // Cognitive Services User
    principalType: 'ServicePrincipal'
    aiFoundryResourceName: aiFoundryResourceName
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = infrastructure.outputs.containerRegistryLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = infrastructure.outputs.containerRegistryName
output AZURE_CONTAINER_APPS_ENVIRONMENT_ID string = infrastructure.outputs.containerAppsEnvironmentId
output AZURE_RESOURCE_GROUP_NAME string = rg.name
output AZURE_CONTAINER_APP_NAME string = app.outputs.webAppName
output WEB_ENDPOINT string = app.outputs.webEndpoint
