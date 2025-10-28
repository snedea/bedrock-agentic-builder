"""GitHub integration for repository creation and deployment."""

import boto3
import json
import base64
from typing import Dict, Any, List, Optional
import requests


class GitHubClient:
    """Client for GitHub API operations."""

    def __init__(self, region: str = 'us-east-1'):
        self.secrets_client = boto3.client('secretsmanager', region_name=region)
        self._token = None

    def _get_token(self) -> str:
        """Get GitHub PAT from Secrets Manager."""
        if self._token:
            return self._token

        try:
            response = self.secrets_client.get_secret_value(
                SecretId='bedrock-builder/github-token'
            )
            self._token = response['SecretString']
            return self._token
        except Exception as e:
            raise Exception(f'Failed to retrieve GitHub token: {str(e)}')

    def _make_request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Make authenticated GitHub API request."""
        headers = {
            'Authorization': f'token {self._get_token()}',
            'Accept': 'application/vnd.github.v3+json',
        }

        url = f'https://api.github.com{endpoint}'

        if method == 'GET':
            response = requests.get(url, headers=headers)
        elif method == 'POST':
            response = requests.post(url, headers=headers, json=data)
        elif method == 'PUT':
            response = requests.put(url, headers=headers, json=data)
        else:
            raise ValueError(f'Unsupported method: {method}')

        response.raise_for_status()
        return response.json() if response.text else {}

    def create_repository(
        self,
        repo_name: str,
        description: str,
        private: bool = True
    ) -> str:
        """Create a new GitHub repository."""
        data = {
            'name': repo_name,
            'description': description,
            'private': private,
            'auto_init': False,
        }

        result = self._make_request('POST', '/user/repos', data)
        return result['html_url']

    def upload_file(
        self,
        owner: str,
        repo: str,
        file_path: str,
        content: str,
        commit_message: str
    ) -> None:
        """Upload a file to repository."""
        # Check if file exists
        try:
            existing = self._make_request('GET', f'/repos/{owner}/{repo}/contents/{file_path}')
            sha = existing['sha']
        except requests.exceptions.HTTPError:
            sha = None

        data = {
            'message': commit_message,
            'content': base64.b64encode(content.encode()).decode(),
        }

        if sha:
            data['sha'] = sha

        self._make_request('PUT', f'/repos/{owner}/{repo}/contents/{file_path}', data)

    def create_release(
        self,
        owner: str,
        repo: str,
        tag_name: str,
        release_name: str,
        body: str
    ) -> str:
        """Create a GitHub release."""
        data = {
            'tag_name': tag_name,
            'name': release_name,
            'body': body,
            'draft': False,
            'prerelease': False,
        }

        result = self._make_request('POST', f'/repos/{owner}/{repo}/releases', data)
        return result['html_url']

    def get_user(self) -> Dict[str, Any]:
        """Get authenticated user information."""
        return self._make_request('GET', '/user')

    def deploy_build(
        self,
        build_id: str,
        repo_name: str,
        files: Dict[str, str],
        description: str
    ) -> str:
        """Deploy a complete build to GitHub."""
        user = self.get_user()
        owner = user['login']

        # Create repository
        repo_url = self.create_repository(repo_name, description)

        # Upload all files
        for file_path, content in files.items():
            self.upload_file(
                owner,
                repo_name,
                file_path,
                content,
                f'Add {file_path}'
            )

        # Create initial release
        self.create_release(
            owner,
            repo_name,
            'v1.0.0',
            'Initial Release',
            f'Built autonomously by Bedrock Agentic Builder\\n\\nBuild ID: {build_id}'
        )

        return repo_url
