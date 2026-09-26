output "registry" {
  value = var.create_registry ? "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images[0].repository_id}" : null
}

output "sql_connection_name" {
  value = google_sql_database_instance.main.connection_name
}

output "runtime_service_account" {
  value = google_service_account.runtime.email
}

output "deployer_service_account" {
  value = google_service_account.deployer.email
}

output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}
