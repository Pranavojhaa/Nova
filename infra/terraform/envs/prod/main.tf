# Defined now, applied at M5 only after docs/prod-readiness.md is complete.
terraform {
  required_version = ">= 1.9"
  backend "gcs" {} # bucket passed at init: -backend-config="bucket=<prod-tfstate-bucket>"
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

provider "google" {
  project = var.project_id
  region  = "asia-south1"
}

module "env" {
  source                 = "../../modules/nova-env"
  project_id             = var.project_id
  env                    = "prod"
  github_repo            = "Pranavojhaa/Nova"
  github_environment     = "production"
  create_registry        = false
  db_tier                = "db-f1-micro"
  db_backups             = true
  db_deletion_protection = true
}

output "sql_connection_name" { value = module.env.sql_connection_name }
output "runtime_service_account" { value = module.env.runtime_service_account }
output "deployer_service_account" { value = module.env.deployer_service_account }
output "workload_identity_provider" { value = module.env.workload_identity_provider }
