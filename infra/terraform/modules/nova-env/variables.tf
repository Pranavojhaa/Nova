variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "asia-south1"
}

variable "env" {
  type = string
  validation {
    condition     = contains(["staging", "prod"], var.env)
    error_message = "env must be staging or prod."
  }
}

variable "github_repo" {
  type        = string
  description = "owner/name of the only repository allowed to deploy."
}

variable "github_environment" {
  type        = string
  description = "GitHub environment whose jobs may impersonate the deployer."
}

variable "create_registry" {
  type        = bool
  description = "Only staging hosts the image registry; prod pulls the verified digest from it."
}

variable "db_tier" {
  type = string
}

variable "db_backups" {
  type = bool
}

variable "db_deletion_protection" {
  type = bool
}
