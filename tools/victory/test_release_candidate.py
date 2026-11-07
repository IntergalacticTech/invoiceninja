import unittest
from copy import deepcopy

from release_candidate import record, validate


class ReleaseCandidateTest(unittest.TestCase):
    def setUp(self):
        self.expected = dict(repository="owner/fork", pr_number=24, head_sha="a" * 40, tree_sha="b" * 40)
        self.candidate = dict(schema=1, merge_sha="c" * 40, **self.expected)

    def test_accepts_identical_tree_even_when_merge_commit_hash_changes(self):
        validate(self.candidate, **self.expected)

    def test_rejects_stale_or_different_candidates(self):
        for key, value in dict(schema=2, repository="other/fork", pr_number=25,
                               head_sha="d" * 40, tree_sha="e" * 40).items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate(dict(self.candidate, **{key: value}), **self.expected)

    def test_rejects_missing_or_malformed_merge_identity(self):
        for value in ("", "x" * 40, "a" * 39):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate(dict(self.candidate, merge_sha=value), **self.expected)

    def test_records_only_ready_same_repo_production_deployment_prs(self):
        pr = dict(number=24, draft=False, base=dict(ref="victory/team-app"),
                  head=dict(sha="a" * 40, repo=dict(full_name="owner/fork")),
                  labels=[dict(name="deployment")])
        inputs = dict(repository="owner/fork", merge_sha="c" * 40, tree_sha="b" * 40)
        self.assertEqual(record(pr, **inputs), self.candidate)
        for field, value in dict(draft=True, base=dict(ref="codex/feature"), labels=[],
                                head=dict(sha="a" * 40, repo=dict(full_name="external/fork"))).items():
            invalid = deepcopy(pr)
            invalid[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                record(invalid, **inputs)


if __name__ == "__main__":
    unittest.main()
