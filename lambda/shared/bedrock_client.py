"""Bedrock API client for Claude model invocations."""

import boto3
import json
from typing import Dict, Any, List, Optional


class BedrockClient:
    """Client for Amazon Bedrock model invocations."""

    def __init__(self, region: str = 'us-east-1'):
        self.bedrock = boto3.client('bedrock-runtime', region_name=region)
        self.model_id = 'anthropic.claude-3-5-sonnet-20241022-v2:0'

    def invoke_model(
        self,
        prompt: str,
        system: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 1.0,
    ) -> str:
        """Invoke Claude model with a prompt."""
        messages = [
            {
                'role': 'user',
                'content': prompt,
            }
        ]

        body = {
            'anthropic_version': 'bedrock-2023-05-31',
            'max_tokens': max_tokens,
            'messages': messages,
            'temperature': temperature,
        }

        if system:
            body['system'] = system

        response = self.bedrock.invoke_model(
            modelId=self.model_id,
            body=json.dumps(body),
        )

        response_body = json.loads(response['body'].read())
        return response_body['content'][0]['text']

    def analyze_requirements(self, task: str) -> Dict[str, Any]:
        """Analyze task requirements (Scout agent)."""
        prompt = f"""Analyze this software development task and provide structured output:

Task: {task}

Provide a JSON response with:
- requirements: List of key requirements
- tech_stack: Recommended technologies
- risks: Potential challenges
- timeline_estimate: Estimated completion time

Return ONLY valid JSON, no other text."""

        system = "You are an expert software analyst who extracts requirements from task descriptions."

        response = self.invoke_model(prompt, system=system, temperature=0.3)

        # Extract JSON from response
        try:
            # Try to parse the entire response as JSON
            return json.loads(response)
        except json.JSONDecodeError:
            # If that fails, try to find JSON in the response
            import re
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            else:
                # Fallback
                return {
                    'requirements': [task],
                    'tech_stack': {},
                    'risks': [],
                    'timeline_estimate': 'unknown',
                }

    def design_architecture(
        self,
        task: str,
        requirements: List[str]
    ) -> Dict[str, Any]:
        """Design system architecture (Architect agent)."""
        prompt = f"""Design a system architecture for this task:

Task: {task}

Requirements:
{chr(10).join(f'- {r}' for r in requirements)}

Provide a JSON response with:
- file_structure: Dict of directories and files
- modules: List of module specifications
- implementation_steps: Ordered list of steps

Return ONLY valid JSON."""

        system = "You are an expert software architect who designs scalable systems."

        response = self.invoke_model(prompt, system=system, temperature=0.5)

        try:
            return json.loads(response)
        except json.JSONDecodeError:
            import re
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            else:
                return {
                    'file_structure': {},
                    'modules': [],
                    'implementation_steps': [],
                }

    def generate_code(
        self,
        file_path: str,
        specification: str,
        language: str = 'python'
    ) -> str:
        """Generate code for a file (Builder agent)."""
        prompt = f"""Generate production-ready {language} code for:

File: {file_path}
Specification:
{specification}

Return ONLY the code, no markdown formatting, no explanations."""

        system = f"You are an expert {language} developer who writes clean, well-documented code."

        return self.invoke_model(prompt, system=system, temperature=0.7)

    def analyze_test_results(
        self,
        test_output: str,
        iteration: int
    ) -> Dict[str, Any]:
        """Analyze test results and suggest fixes (Tester agent)."""
        prompt = f"""Analyze these test results from iteration {iteration}:

{test_output}

Provide a JSON response with:
- tests_passed: boolean
- failures: List of test failures with details
- recommendations: List of specific fix recommendations
- root_cause: Analysis of what went wrong

Return ONLY valid JSON."""

        system = "You are an expert QA engineer who diagnoses test failures and suggests fixes."

        response = self.invoke_model(prompt, system=system, temperature=0.3)

        try:
            return json.loads(response)
        except json.JSONDecodeError:
            import re
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            else:
                return {
                    'tests_passed': False,
                    'failures': [test_output],
                    'recommendations': ['Review test output manually'],
                    'root_cause': 'Unable to parse test results',
                }
