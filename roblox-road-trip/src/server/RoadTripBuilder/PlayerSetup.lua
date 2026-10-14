-- โมดูล PlayerSetup (ส่วนหนึ่งของ RoadTripBuilder) : ModuleScript ชื่อ PlayerSetup
return function(S)
local Workspace, Players, ZONES, TOTAL, spawn, setProgress, checkpoints, playerState, FINISH_INDEX, destroyCar = S.Workspace, S.Players, S.ZONES, S.TOTAL, S.spawn, S.setProgress, S.checkpoints, S.playerState, S.FINISH_INDEX, S.destroyCar

local function onPlayerAdded(player)
	playerState[player] = { progress = 0 }

	local ls = Instance.new("Folder")
	ls.Name = "leaderstats"
	local cp = Instance.new("IntValue")
	cp.Name = "Checkpoint"
	cp.Parent = ls
	local trips = Instance.new("IntValue")
	trips.Name = "Trips"
	trips.Parent = ls
	ls.Parent = player

	player:SetAttribute("CheckpointTotal", FINISH_INDEX)
	setProgress(player, 0)

	player.CharacterAdded:Connect(function(char)
		local root = char:WaitForChild("HumanoidRootPart", 10)
		local st = playerState[player]
		if root and st and st.progress > 0 then
			task.wait()
			char:PivotTo(checkpoints[st.progress].cf * CFrame.new(0, 4, 0))
		end
	end)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, p in ipairs(Players:GetPlayers()) do
	task.spawn(onPlayerAdded, p)
end

Players.PlayerRemoving:Connect(function(player)
	destroyCar(player)
	playerState[player] = nil
end)

-- ลบพื้น/จุดเกิดเดิมของเทมเพลต แล้วให้ผู้เล่นเกิดใหม่ที่จุดเกิดของแมพนี้
for _, name in ipairs({ "Baseplate", "SpawnLocation" }) do
	local obj = Workspace:FindFirstChild(name)
	if obj and obj ~= spawn then
		obj:Destroy()
	end
end
for _, pl in ipairs(Players:GetPlayers()) do
	task.spawn(function()
		pl:LoadCharacter()
	end)
end

print(string.format("[RoadTrip] สร้างแมพเสร็จ: ถนนยาว %d studs, %d โซน, %d เช็คพอยต์", TOTAL, #ZONES, FINISH_INDEX))

S.onPlayerAdded = onPlayerAdded
end
