terraform {
  required_version = ">= 1.9"
  backend "gcs" {} # bucket passed at init: -backend-config="bucket=<staging-tfstate-bucket>"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

variable "project_id" {
  type = string
}

variable "prod_project_number" {
  type        = string
  default     = ""
  description = "Set at M5 so prod's Cloud Run can pull staging-verified images."
}

variable "prod_deployer_service_account" {
  type        = string
  default     = ""
  description = "Set at M5 so the promote workflow can resolve verified-<sha> tags."
}

provider "google" {
  project = var.project_id
  region  = "asia-south1"
}

module "env" {
  source                 = "../../modules/nova-env"
  project_id             = var.project_id
  env                    = "staging"
  github_repo            = "Pranavojhaa/Nova"
  github_environment     = "staging"
  create_registry        = true
  db_tier                = "db-f1-micro"
  db_backups             = false
  db_deletion_protection = false
}

locals {
  prod_readers = compact([
    var.prod_project_number == "" ? "" : "serviceAccount:service-${var.prod_project_number}@serverless-robot-prod.iam.gserviceaccount.com",
    var.prod_deployer_service_account == "" ? "" : "serviceAccount:${var.prod_deployer_service_account}",
  ])
}

resource "google_artifact_registry_repository_iam_member" "prod_pull" {
  for_each   = toset(local.prod_readers)
  project    = var.project_id
  location   = "asia-south1"
  repository = "nova"
  role       = "roles/artifactregistry.reader"
  member     = each.value
  depends_on = [module.env]
}

output "registry" { value = module.env.registry }
output "sql_connection_name" { value = module.env.sql_connection_name }
output "runtime_service_account" { value = module.env.runtime_service_account }
output "deployer_service_account" { value = module.env.deployer_service_account }
output "workload_identity_provider" { value = module.env.workload_identity_provider }
