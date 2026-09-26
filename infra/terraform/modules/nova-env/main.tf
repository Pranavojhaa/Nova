terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

locals {
  services = [
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
    "sts.googleapis.com",
  ]
  # Secret containers only. Values are written with gcloud (docs/environments.md) so they never enter Terraform state.
  secrets = ["DATABASE_URL", "NOVA_MASTER_KEY"]
}

resource "google_project_service" "enabled" {
  for_each           = toset(local.services)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# --- Images (staging only) ------------------------------------------------------------------

resource "google_artifact_registry_repository" "images" {
  count         = var.create_registry ? 1 : 0
  project       = var.project_id
  location      = var.region
  repository_id = "nova"
  format        = "DOCKER"
  depends_on    = [google_project_service.enabled]
}

# --- Database -------------------------------------------------------------------------------

resource "google_sql_database_instance" "main" {
  project             = var.project_id
  name                = "nova-${var.env}"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.db_deletion_protection

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_size         = 10
    disk_autoresize   = true

    # Public IP with no authorized networks: reachable only through the IAM-checked Cloud SQL connector.
    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = var.db_backups
      point_in_time_recovery_enabled = var.db_backups
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_sql_database" "nova" {
  project  = var.project_id
  instance = google_sql_database_instance.main.name
  name     = "nova"
}

# --- Secrets --------------------------------------------------------------------------------

resource "google_secret_manager_secret" "app" {
  for_each  = toset(local.secrets)
  project   = var.project_id
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}

# --- Runtime identity -----------------------------------------------------------------------

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "nova-runtime"
  display_name = "Nova API, worker and migrations (${var.env})"
}

resource "google_project_iam_member" "runtime_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_reads" {
  for_each  = google_secret_manager_secret.app
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# --- Deploy identity (GitHub Actions via Workload Identity Federation; no keys) --------------

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "nova-deployer"
  display_name = "GitHub Actions deployer (${var.env})"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"
  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.environment" = "assertion.environment"
  }
  attribute_condition = "assertion.repository == \"${var.github_repo}\" && assertion.environment == \"${var.github_environment}\""
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

resource "google_project_iam_member" "deployer_roles" {
  for_each = toset(["roles/run.admin", "roles/cloudsql.viewer"])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_acts_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  count      = var.create_registry ? 1 : 0
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.images[0].name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}
