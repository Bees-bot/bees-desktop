# Files in threads

Attach files to a thread. The Client stores immutable SHA-256 objects privately and downloads authorized thread objects from the owning Client over direct TLS or the encrypted relay. There is no root folder, shared-drive configuration, or organization-wide filesystem access. Agents receive copies only in their run’s inputs directory and publish outputs into the same thread. Path checks, sandbox policy, symlink checks and content hashes fence file operations.
